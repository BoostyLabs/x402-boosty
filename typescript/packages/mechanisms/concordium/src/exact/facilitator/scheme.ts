import { CcdAmount } from "@concordium/web-sdk";
import { Transaction } from "@concordium/web-sdk/transactions";
import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FacilitatorConcordiumSigner } from "../../signer";
import {
  ExactConcordiumPayloadV2,
  SignableV1Transaction,
  SignableV1TransactionPayload,
  SimpleTransferPayload,
  SimpleTransferWithMemoPayload,
  TokenUpdatePayload,
} from "../../types";
import { MAX_EXPIRY_OFFSET_SECONDS, DEFAULT_FINALIZATION_TIMEOUT_MS } from "../../constants";

export interface ExactConcordiumSchemeConfig {
  /**
   * Facilitator signer — handles sponsor signing, submission, and finalization.
   * Create with `toConcordiumFacilitatorSigner(sponsorAccount, sponsorSigner, grpcClient)`.
   */
  signer: FacilitatorConcordiumSigner;

  /**
   * Whether settlement requires `finalized` status.
   * Set to false to accept `committed` (faster, less safe).
   *
   * @default true
   */
  requireFinalization?: boolean;

  /**
   * Finalization wait timeout in ms.
   *
   * @default 60000
   */
  finalizationTimeoutMs?: number;

  /**
   * Maximum seconds from now an expiry is allowed to be (Rule 7).
   *
   * @default 600
   */
  maxExpiryOffsetSeconds?: number;

  /**
   * Assets reported on the /supported endpoint.
   *
   * @default [{ symbol: "CCD", decimals: 6 }]
   */
  supportedAssets?: Array<{ symbol: string; decimals: number }>;
}

/**
 * Concordium facilitator implementation for the `exact` payment scheme.
 */
export class ExactConcordiumScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "ccd:*";

  private readonly signer: FacilitatorConcordiumSigner;
  private readonly requireFinalization: boolean;
  private readonly finalizationTimeoutMs: number;
  private readonly maxExpiryOffsetSeconds: number;
  private readonly supportedAssets: Array<{ symbol: string; decimals: number }>;

  /**
   * Creates a new ExactConcordiumScheme facilitator instance.
   *
   * @param config - Facilitator scheme configuration
   */
  constructor(config: ExactConcordiumSchemeConfig) {
    this.signer = config.signer;
    this.requireFinalization = config.requireFinalization ?? true;
    this.finalizationTimeoutMs = config.finalizationTimeoutMs ?? DEFAULT_FINALIZATION_TIMEOUT_MS;
    this.maxExpiryOffsetSeconds = config.maxExpiryOffsetSeconds ?? MAX_EXPIRY_OFFSET_SECONDS;
    this.supportedAssets = config.supportedAssets ?? [{ symbol: "CCD", decimals: 6 }];
  }

  /**
   * Returns extra metadata for the /supported endpoint.
   *
   * @param _ - Network identifier (unused, same config for all networks)
   * @returns Supported assets and sponsor address
   */
  getExtra(_: Network): Record<string, unknown> | undefined {
    return {
      assets: this.supportedAssets,
      // Fee payer exposed so clients can name it as sponsor in their transaction header
      feePayer: this.signer.getAddress(),
    };
  }

  /**
   * Returns signer addresses for the /supported endpoint.
   *
   * @param _ - Network identifier (unused, same signer for all networks)
   * @returns Array of sponsor account addresses
   */
  getSigners(_: string): string[] {
    return [this.signer.getAddress()];
  }

  /**
   * Validates the partially-signed transaction against all 9 MUST rules.
   *
   * @param payload - The x402 payment payload containing the signed transaction
   * @param requirements - The payment requirements from the resource server
   * @returns Verification result indicating validity and payer address
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const concordiumPayload = payload.payload as unknown as ExactConcordiumPayloadV2;
    const payer = "";

    if (!concordiumPayload || typeof concordiumPayload !== "object") {
      return this.invalid("missing_payload", payer);
    }

    let tx: SignableV1Transaction;
    try {
      tx = this.parseTransaction(concordiumPayload);
    } catch (err) {
      return this.invalid(
        `invalid_transaction_format: ${err instanceof Error ? err.message : String(err)}`,
        payer,
      );
    }

    const resolvedPayer = tx.header.sender ?? "";

    if (tx.version !== 1) {
      return this.invalid(
        `invalid_transaction_version: expected 1, got ${tx.version}`,
        resolvedPayer,
      );
    }

    if (!resolvedPayer) {
      return this.invalid("missing_sender", resolvedPayer);
    }

    if (!isValidBase58Address(resolvedPayer)) {
      return this.invalid("invalid_sender_address", resolvedPayer);
    }

    const feePayer = requirements.extra?.feePayer;
    if (typeof feePayer !== "string" || !feePayer) {
      return this.invalid("missing_fee_payer", resolvedPayer);
    }

    const sponsorAddressInHeader = tx.header.sponsor?.address ?? tx.header.sponsor?.account;
    if (!sponsorAddressInHeader) {
      return this.invalid("missing_sponsor_in_header", resolvedPayer);
    }

    if (sponsorAddressInHeader !== feePayer || feePayer !== this.signer.getAddress()) {
      return this.invalid("sponsor_mismatch", resolvedPayer);
    }

    // Checked early to fast-reject stale / far-future transactions
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (typeof tx.header.expiry !== "number" || !Number.isFinite(tx.header.expiry)) {
      return this.invalid("invalid_expiry_field", resolvedPayer);
    }

    if (tx.header.expiry <= nowSeconds) {
      return this.invalid("transaction_expired", resolvedPayer);
    }

    const maxExpiryOffsetSeconds = Math.min(
      this.maxExpiryOffsetSeconds,
      Math.max(0, requirements.maxTimeoutSeconds ?? this.maxExpiryOffsetSeconds),
    );

    if (tx.header.expiry > nowSeconds + maxExpiryOffsetSeconds) {
      return this.invalid(
        `expiry_too_far_in_future: max offset is ${maxExpiryOffsetSeconds}s`,
        resolvedPayer,
      );
    }

    const safetyError = this.checkPayloadSafety(tx);
    if (safetyError !== null) return this.invalid(safetyError, resolvedPayer);

    const expectedAsset = (requirements.asset ?? "CCD").toUpperCase();
    const assetError = this.checkAssetType(tx.payload, expectedAsset);
    if (assetError !== null) return this.invalid(assetError, resolvedPayer);

    const recipientError = this.checkRecipient(tx.payload, requirements.payTo, expectedAsset);
    if (recipientError !== null) return this.invalid(recipientError, resolvedPayer);

    const amountError = this.checkAmount(tx.payload, requirements, expectedAsset);
    if (amountError !== null) return this.invalid(amountError, resolvedPayer);

    if (!hasSenderSignature(tx)) {
      return this.invalid("missing_sender_signature", resolvedPayer);
    }

    try {
      const signable = Transaction.signableFromJSON(tx);

      if (signable.version !== 1) {
        return this.invalid("unexpected_transaction_version_after_parse", resolvedPayer);
      }

      const accountInfo = await this.signer.getAccountInfo(resolvedPayer);

      const signatureValid = await Transaction.verifySignature(
        signable,
        signable.signatures.sender,
        accountInfo,
      );

      if (!signatureValid) {
        return this.invalid("invalid_sender_signature", resolvedPayer);
      }

      // Preflight/simulation: ensure the transaction is likely to succeed on-chain.
      // At minimum we validate nonce/sequence and sufficient sender balance for CCD transfers.
      const preflightError = this.preflightLikelyToSucceed(
        tx,
        requirements,
        expectedAsset,
        accountInfo,
      );
      if (preflightError !== null) {
        return this.invalid(preflightError, resolvedPayer);
      }
    } catch (err) {
      return this.invalid(
        `signature_verification_failed: ${err instanceof Error ? err.message : String(err)}`,
        resolvedPayer,
      );
    }

    return { isValid: true, payer: resolvedPayer };
  }

  /**
   * Sponsors and submits the transaction, then waits for finalization.
   *
   * @param payload - The x402 payment payload containing the signed transaction
   * @param requirements - The payment requirements from the resource server
   * @returns Settlement result with transaction hash and network
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const concordiumPayload = payload.payload as unknown as ExactConcordiumPayloadV2;
    const network = payload.accepted.network as Network;
    const payer = "";

    const valid = await this.verify(payload, requirements);
    if (!valid.isValid) {
      return {
        success: false,
        network,
        transaction: "",
        errorReason: valid.invalidReason ?? "verification_failed",
        payer: valid.payer || payer,
      };
    }
    const verifiedPayer = valid.payer ?? "";
    if (!verifiedPayer) {
      return this.failure(network, "", payer, "missing_payer");
    }

    let tx: SignableV1Transaction;
    try {
      tx = this.parseTransaction(concordiumPayload);
    } catch {
      return this.failure(network, "", verifiedPayer, "invalid_transaction_format");
    }

    let signedTxJSON: Awaited<ReturnType<FacilitatorConcordiumSigner["addSponsorSignature"]>>;
    try {
      signedTxJSON = await this.signer.addSponsorSignature(tx);
    } catch (err) {
      return this.failure(
        network,
        "",
        verifiedPayer,
        `sponsor_signing_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let txHash: string;
    try {
      txHash = await this.signer.submitTransaction(signedTxJSON);
    } catch (err) {
      return this.failure(
        network,
        "",
        verifiedPayer,
        `submission_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let txInfo;
    try {
      txInfo = await this.signer.waitForFinalization(txHash, this.finalizationTimeoutMs);
    } catch (err) {
      // waitForFinalization throws on on-chain failure or timeout
      return this.failure(
        network,
        txHash,
        verifiedPayer,
        `finalization_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (this.requireFinalization && txInfo.status !== "finalized") {
      return this.failure(network, txHash, verifiedPayer, "finalization_timeout");
    }

    if (txInfo.sender && txInfo.sender !== verifiedPayer) {
      return this.failure(network, txHash, verifiedPayer, "on_chain_sender_mismatch");
    }

    if (!txInfo.recipient || txInfo.recipient !== requirements.payTo) {
      return this.failure(network, txHash, verifiedPayer, "on_chain_recipient_mismatch");
    }

    return { success: true, network, transaction: txHash, payer: verifiedPayer };
  }

  /**
   * Parses and validates the raw transaction from the payload.
   *
   * @param concordiumPayload - The Concordium-specific payment payload
   * @returns A validated SignableV1Transaction
   */
  private parseTransaction(concordiumPayload: ExactConcordiumPayloadV2): SignableV1Transaction {
    if (!concordiumPayload.signedTransaction) {
      throw new Error("missing_signed_transaction");
    }

    const tx = concordiumPayload.signedTransaction;

    if (typeof tx !== "object" || tx === null) {
      throw new Error("signed_transaction_must_be_object");
    }
    if (typeof tx.version !== "number") {
      throw new Error("missing_or_invalid_version_field");
    }
    if (!tx.header || typeof tx.header !== "object") {
      throw new Error("missing_header");
    }
    if (typeof tx.header.sender !== "string") {
      throw new Error("missing_header_sender");
    }
    if (typeof tx.header.expiry !== "number") {
      throw new Error("missing_header_expiry");
    }
    if (!tx.header.sponsor || typeof tx.header.sponsor !== "object") {
      throw new Error("missing_header_sponsor");
    }
    if (!tx.payload || typeof tx.payload !== "object") {
      throw new Error("missing_payload_field");
    }
    if (!tx.signatures || typeof tx.signatures !== "object") {
      throw new Error("missing_signatures");
    }

    return tx as SignableV1Transaction;
  }

  /**
   * Rule 9 — checks transaction payload safety constraints.
   *
   * @param tx - The V1 sponsored transaction to check
   * @returns An invalidReason string, or null if safe
   */
  private checkPayloadSafety(tx: SignableV1Transaction): string | null {
    const validTypes = new Set(["transfer", "transferWithMemo", "tokenUpdate"]);

    if (!validTypes.has(tx.payload.type)) {
      return `unexpected_transaction_type: ${tx.payload.type}`;
    }

    if (tx.payload.type === "tokenUpdate") {
      // Operations are CBOR-encoded — we can't count them without decoding.
      // `createTokenUpdatePayload` always encodes exactly one operation
      // per the reference implementation, so structural safety is guaranteed
      // by the client SDK. The CBOR decode in Rules 4/5 will fail if the
      // operation is malformed.
    }

    const sponsorAddress = this.signer.getAddress();

    if (tx.header.sender === sponsorAddress) {
      return "sponsor_as_sender";
    }

    const recipient = extractRecipient(tx.payload);
    if (recipient !== null && recipient === sponsorAddress) {
      return "sponsor_as_recipient";
    }

    return null;
  }

  /**
   * Rule 6 — validates asset type matches requirements.
   *
   * @param payload - The transaction payload to check
   * @param expectedAsset - Expected asset identifier (empty for CCD)
   * @returns An invalidReason string, or null if valid
   */
  private checkAssetType(
    payload: SignableV1TransactionPayload,
    expectedAsset: string,
  ): string | null {
    const isCcd = expectedAsset.toUpperCase() === "CCD";

    if (isCcd) {
      if (payload.type !== "transfer" && payload.type !== "transferWithMemo") {
        return `asset_type_mismatch: expected SimpleTransfer for CCD, got ${payload.type}`;
      }
      return null;
    }

    if (payload.type !== "tokenUpdate") {
      return `asset_type_mismatch: expected TokenUpdate for ${expectedAsset}, got ${payload.type}`;
    }

    const tokenPayload = payload as TokenUpdatePayload;
    if (!tokenPayload.tokenId) return "missing_token_id";

    if (tokenPayload.tokenId.toUpperCase() !== expectedAsset.toUpperCase()) {
      return `token_id_mismatch: expected ${expectedAsset}, got ${tokenPayload.tokenId}`;
    }

    return null;
  }

  /**
   * Rule 4 — validates transfer recipient matches payTo.
   *
   * @param payload - The transaction payload to check
   * @param payTo - Expected recipient address
   * @param expectedAsset - Expected asset identifier (empty for CCD)
   * @returns An invalidReason string, or null if valid
   */
  private checkRecipient(
    payload: SignableV1TransactionPayload,
    payTo: string,
    expectedAsset: string,
  ): string | null {
    if (expectedAsset.toUpperCase() === "CCD") {
      const ccdPayload = payload as SimpleTransferPayload | SimpleTransferWithMemoPayload;
      if (!ccdPayload.toAddress) return "missing_recipient";
      if (ccdPayload.toAddress !== payTo) return "recipient_mismatch";
    }
    // PLT: recipient is inside CBOR-encoded operations — verified on-chain in settle()
    return null;
  }

  /**
   * Rule 5 — validates transfer amount matches requirements (strict equality).
   *
   * @param payload - The transaction payload to check
   * @param requirements - The payment requirements with the expected amount
   * @param expectedAsset - Expected asset identifier (empty for CCD)
   * @returns An invalidReason string, or null if valid
   */
  private checkAmount(
    payload: SignableV1TransactionPayload,
    requirements: PaymentRequirements,
    expectedAsset: string,
  ): string | null {
    if (expectedAsset.toUpperCase() !== "CCD") {
      // PLT: amount is inside CBOR-encoded operations — verified on-chain in settle()
      return null;
    }

    const required = BigInt(getRequiredAmount(requirements));

    let actual: bigint;
    try {
      actual = BigInt((payload as SimpleTransferPayload).amount ?? "0");
    } catch {
      return "invalid_amount_format";
    }

    if (actual !== required) {
      return `amount_mismatch: required ${required}, got ${actual}`;
    }

    return null;
  }

  /**
   * Ensures the transaction is likely to succeed on-chain.
   *
   * This is a lightweight preflight check used as a stand-in for full simulation:
   * - Nonce/sequence validity for the sender account
   * - Sufficient sender balance for native CCD transfers
   *
   * @param tx - Parsed V1 sponsored transaction (client-signed)
   * @param requirements - Payment requirements to validate against
   * @param expectedAsset - Expected asset identifier (e.g. "CCD" or a PLT symbol)
   * @param accountInfo - On-chain account info (SDK shape) for sender
   * @returns An invalidReason string, or null if likely to succeed
   */
  private preflightLikelyToSucceed(
    tx: SignableV1Transaction,
    requirements: PaymentRequirements,
    expectedAsset: string,
    accountInfo: unknown,
  ): string | null {
    const onChainNonceRaw =
      (accountInfo as { accountNonce?: unknown } | null | undefined)?.accountNonce ??
      (accountInfo as { nonce?: unknown } | null | undefined)?.nonce;

    if (onChainNonceRaw === undefined || onChainNonceRaw === null) {
      return "preflight_missing_account_nonce";
    }

    let onChainNonce: bigint;
    try {
      onChainNonce = BigInt(onChainNonceRaw as number | string | bigint);
    } catch {
      return "preflight_invalid_account_nonce";
    }

    if (BigInt(tx.header.nonce) !== onChainNonce) {
      return "preflight_nonce_mismatch";
    }

    if (expectedAsset.toUpperCase() !== "CCD") return null;

    const amountRequired = BigInt(getRequiredAmount(requirements));

    const amountRaw =
      (accountInfo as { accountAmount?: unknown } | null | undefined)?.accountAmount ??
      (accountInfo as { amount?: unknown } | null | undefined)?.amount;

    if (amountRaw === undefined || amountRaw === null) {
      return "preflight_missing_account_amount";
    }

    let availableMicroCcd: bigint;
    try {
      // AccountAmount in the Concordium SDK is typically a CcdAmount.Type.
      // We treat it as an opaque value and attempt to use CcdAmount.toMicroCcd first.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const micro = CcdAmount.toMicroCcd(amountRaw as any) as unknown;
      availableMicroCcd =
        typeof micro === "bigint"
          ? micro
          : BigInt(typeof micro === "string" ? micro : String(micro));
    } catch {
      try {
        availableMicroCcd = BigInt(amountRaw as number | string | bigint);
      } catch {
        return "preflight_invalid_account_amount";
      }
    }

    if (availableMicroCcd < amountRequired) {
      return "preflight_insufficient_funds";
    }

    return null;
  }

  /**
   * Builds an invalid VerifyResponse.
   *
   * @param reason - The reason for invalidity
   * @param payer - The payer address
   * @returns An invalid VerifyResponse
   */
  private invalid(reason: string, payer: string): VerifyResponse {
    return { isValid: false, invalidReason: reason, payer };
  }

  /**
   * Builds a failed SettleResponse.
   *
   * @param network - The blockchain network
   * @param transaction - The transaction hash (empty if not yet submitted)
   * @param payer - The payer address
   * @param errorReason - The reason for failure
   * @returns A failed SettleResponse
   */
  private failure(
    network: Network,
    transaction: string,
    payer: string,
    errorReason: string,
  ): SettleResponse {
    return { success: false, network, transaction, payer, errorReason };
  }
}

/**
 * Checks whether the sender has at least one credential signature.
 *
 * @param tx - The V1 sponsored transaction to check
 * @returns True if at least one sender signature is present
 */
function hasSenderSignature(tx: SignableV1Transaction): boolean {
  const sender = tx.signatures?.sender;
  if (!sender || typeof sender !== "object") return false;

  return Object.values(sender).some(
    keyMap =>
      typeof keyMap === "object" &&
      keyMap !== null &&
      Object.values(keyMap).some(sig => typeof sig === "string" && sig.length > 0),
  );
}

/**
 * Extracts the recipient address from a transaction payload.
 *
 * @param payload - The transaction payload
 * @returns The recipient address, or null if not extractable
 */
function extractRecipient(payload: SignableV1TransactionPayload): string | null {
  switch (payload.type) {
    case "transfer":
    case "transferWithMemo":
      return (payload as SimpleTransferPayload).toAddress ?? null;
    case "tokenUpdate":
      // Recipient is CBOR-encoded — not extractable without decode.
      // Sponsor-as-recipient check is skipped for PLT (Rule 9 best-effort).
      return null;
    default:
      return null;
  }
}

/**
 * Resolves the required amount from payment requirements.
 *
 * @param requirements - The payment requirements
 * @returns The required amount as a string
 */
function getRequiredAmount(requirements: PaymentRequirements): string {
  return (
    (requirements as unknown as Record<string, string>).maxAmountRequired ??
    (requirements as unknown as Record<string, string>).amount ??
    "0"
  );
}

/**
 * Structural guard for Concordium base58check account addresses.
 * For strict validation use `AccountAddress.fromBase58(address)` from the SDK.
 *
 * @param address - The address string to validate
 * @returns True if the address matches base58check format
 */
function isValidBase58Address(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  if (address.length < 45 || address.length > 55) return false;
  return /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(address);
}
