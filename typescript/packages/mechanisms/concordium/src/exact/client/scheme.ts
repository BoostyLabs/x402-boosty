import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import {
  AccountAddress,
  TransactionExpiry,
  TokenId,
  TokenAmount,
  CborAccountAddress,
  CcdAmount,
  TokenOperationType,
  Cbor,
} from "@concordium/web-sdk";
import { Transaction } from "@concordium/web-sdk/transactions";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkClient,
  Network,
} from "@x402/core/types";
import type { ClientConcordiumSigner } from "../../signer";
import type { ExactConcordiumPayloadV2 } from "../../types";
import { getConcordiumGrpcUrl, parseGrpcUrl } from "../../constants";

export interface ClientConcordiumConfig {
  /**
   * Optional: override the gRPC endpoint derived from the network config.
   * Useful for local devnet or custom node setups.
   */
  grpcUrl?: string;
  /**
   * Whether to use TLS for the gRPC connection.
   *
   * @default true
   */
  useTls?: boolean;
}

/**
 * Concordium client implementation for the `exact` payment scheme.
 *
 * @example
 * ```typescript
 * import { ExactConcordiumScheme } from "@x402/concordium/exact/client";
 * import { buildAccountSigner, parseWallet, AccountAddress } from "@concordium/web-sdk";
 *
 * const walletExport = parseWallet(readFileSync("./wallet.export", "utf8"));
 * const signer: ClientConcordiumSigner = {
 *   accountAddress: AccountAddress.fromBase58(walletExport.value.address),
 *   signer: buildAccountSigner(walletExport),
 * };
 *
 * const scheme = new ExactConcordiumScheme(signer);
 * ```
 */
export class ExactConcordiumScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  /**
   * Creates a new ExactConcordiumScheme instance.
   *
   * @param signer - Client signer holding the account address and signing key
   * @param config - Optional gRPC connection configuration
   */
  constructor(
    private readonly signer: ClientConcordiumSigner,
    private readonly config?: ClientConcordiumConfig,
  ) {}

  /**
   * Creates a payment payload for the `exact` scheme on Concordium.
   *
   * Validates requirements, builds the transaction (CCD or PLT), signs as
   * sender, and returns the serialized payload ready to attach to a
   * `PaymentPayload`.
   *
   * @param x402Version       - Must be 2
   * @param requirements      - Payment requirements from the resource server,
   *                            must include `extra.feePayer`
   * @returns The x402 version and scheme-specific payment payload
   */
  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    if (!this.signer.accountAddress) {
      throw new Error("Concordium account address is required");
    }

    if (!requirements.payTo) {
      throw new Error("payTo address is required");
    }

    if (!requirements.amount || !/^\d+$/.test(requirements.amount)) {
      throw new Error("amount must be a non-empty decimal string");
    }

    const feePayer = requirements.extra?.feePayer;
    if (typeof feePayer !== "string" || !feePayer) {
      throw new Error(
        "requirements.extra.feePayer is required. " +
          "The resource server must include the facilitator's fee payer address in PaymentRequirements.",
      );
    }

    const grpcClient = this.createGrpcClient(requirements.network);

    const nonceResult = await grpcClient.getNextAccountNonce(this.signer.accountAddress);

    const isNativeCcd =
      !requirements.asset ||
      requirements.asset === "" ||
      requirements.asset.toUpperCase() === "CCD";

    const sponsorAccountAddress = AccountAddress.fromBase58(feePayer);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const maxTimeoutSeconds = requirements.maxTimeoutSeconds;
    if (!Number.isInteger(maxTimeoutSeconds) || maxTimeoutSeconds <= 5) {
      throw new Error("requirements.maxTimeoutSeconds must be an integer greater than 5");
    }

    const metadata = {
      sender: this.signer.accountAddress,
      nonce: nonceResult.nonce,
      expiry: TransactionExpiry.fromEpochSeconds(nowSeconds + maxTimeoutSeconds - 5),
    };

    const signable = isNativeCcd
      ? this.buildCcdTransfer(requirements.payTo, requirements.amount)
          .addMetadata(metadata)
          .addSponsor(sponsorAccountAddress)
          .build()
      : this.buildPltTransfer(
          requirements.payTo,
          requirements.amount,
          requirements.asset,
          (requirements.extra as Record<string, unknown> | undefined)?.decimals as
            | number
            | undefined,
        )
          .addMetadata(metadata)
          .addSponsor(sponsorAccountAddress)
          .build();

    const signed = await Transaction.sign(signable as Transaction.Signable, this.signer.signer);

    const signedJson = Transaction.toJSON(signed);

    const concordiumPayload: ExactConcordiumPayloadV2 = {
      signedTransaction: toJsonSafe(
        signedJson,
      ) as unknown as ExactConcordiumPayloadV2["signedTransaction"],
    };

    return {
      x402Version,
      payload: concordiumPayload as unknown as PaymentPayload["payload"],
    };
  }

  /**
   * Builds a native CCD simple transfer.
   *
   * @param payTo  - Recipient address (base58check)
   * @param amount - Transfer amount in microCCD (atomic units, string)
   * @returns A transaction builder for a CCD simple transfer
   */
  private buildCcdTransfer(payTo: string, amount: string) {
    const recipientAddress = AccountAddress.fromBase58(payTo);
    const microCcdAmount = CcdAmount.fromMicroCcd(BigInt(amount));

    return Transaction.transfer({
      toAddress: recipientAddress,
      amount: microCcdAmount,
    });
  }

  /**
   * Builds a PLT token transfer via `Transaction.tokenUpdate`.
   *
   * @param payTo   - Recipient address (base58check)
   * @param amount  - Transfer amount in smallest token units (string)
   * @param tokenId - Token identifier (e.g. "EURR")
   * @param decimals - Number of decimal places for the token (e.g. 6 for EURR)
   * @returns A transaction builder for a PLT token transfer
   */
  private buildPltTransfer(payTo: string, amount: string, tokenId: string, decimals?: number) {
    const tokenDecimals = decimals ?? 0;
    const ops = [
      {
        [TokenOperationType.Transfer]: {
          amount: TokenAmount.create(BigInt(amount), tokenDecimals),
          recipient: CborAccountAddress.fromAccountAddress(AccountAddress.fromBase58(payTo)),
          memo: undefined,
        },
      },
    ];

    return Transaction.tokenUpdate({
      tokenId: TokenId.fromString(tokenId),
      operations: Cbor.encode(ops),
    });
  }

  /**
   * Creates a gRPC client for the given network.
   *
   * @param network - CAIP-2 network identifier
   * @returns A connected ConcordiumGRPCNodeClient instance
   */
  private createGrpcClient(network: Network): ConcordiumGRPCNodeClient {
    const grpcUrl = this.config?.grpcUrl ?? getConcordiumGrpcUrl(network);
    const [host, port] = parseGrpcUrl(grpcUrl);
    const creds =
      (this.config?.useTls ?? true) ? credentials.createSsl() : credentials.createInsecure();

    return new ConcordiumGRPCNodeClient(host, port, creds);
  }
}

/**
 * Recursively converts BigInt values to Numbers for JSON serialization.
 * The Concordium SDK outputs BigInts in transaction headers (nonce, numSignatures,
 * executionEnergyAmount) which are not JSON-serializable. These values are small
 * enough to fit safely within Number.MAX_SAFE_INTEGER.
 *
 * @param value - The value to sanitize
 * @returns A JSON-safe copy with BigInts converted to Numbers
 */
function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
      return value.toString();
    }
    return Number(value);
  }
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}
