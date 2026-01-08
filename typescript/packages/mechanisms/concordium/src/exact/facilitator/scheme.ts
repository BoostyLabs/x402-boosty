import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { ConcordiumClient, TransactionInfo } from "../../client";
import { ExactConcordiumPayloadV2 } from "../../types";

/**
 * Configuration for the Concordium facilitator scheme
 */
export interface ExactConcordiumSchemeConfig {
  /**
   * Concordium node client for verifying transactions
   */
  client: ConcordiumClient;

  /**
   * Whether to wait for transaction finalization before settling.
   * If false, accepts committed (but not finalized) transactions.
   *
   * @default true
   */
  requireFinalization?: boolean;

  /**
   * Timeout in milliseconds for waiting for finalization
   *
   * @default 60000 (60 seconds)
   */
  finalizationTimeoutMs?: number;

  /**
   * Supported assets (for /supported endpoint).
   * If not provided, only CCD is reported.
   */
  supportedAssets?: Array<{ symbol: string; decimals: number }>;
}

/**
 * Concordium facilitator implementation for the Exact payment scheme.
 */
export class ExactConcordiumScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";

  private readonly client: ConcordiumClient;
  private readonly requireFinalization: boolean;
  private readonly finalizationTimeoutMs: number;
  private readonly supportedAssets: Array<{ symbol: string; decimals: number }>;

  /**
   * Creates a new ExactConcordiumScheme instance for facilitator operations.
   *
   * @param config - Configuration with Concordium node client
   */
  constructor(config: ExactConcordiumSchemeConfig) {
    this.client = config.client;
    this.requireFinalization = config.requireFinalization ?? true;
    this.finalizationTimeoutMs = config.finalizationTimeoutMs ?? 60000;
    this.supportedAssets = config.supportedAssets ?? [{ symbol: "CCD", decimals: 6 }];
  }

  /**
   * Returns supported assets for /supported endpoint.
   */
  getExtra(_: Network): Record<string, unknown> | undefined {
    return {
      assets: this.supportedAssets,
    };
  }

  /**
   * Concordium client broadcasts directly; no facilitator signers.
   */
  getSigners(_: string): string[] {
    return [];
  }

  /**
   * Verifies a payment payload by checking the transaction on-chain.
   *
   * @param payload - The payment payload to verify
   * @param requirements - The payment requirements
   * @returns Promise resolving to verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const concordiumPayload = payload.payload as ExactConcordiumPayloadV2;
    const payer = concordiumPayload.sender;

    if (!concordiumPayload.txHash) {
      return this.invalid("missing_tx_hash", payer);
    }

    if (!concordiumPayload.sender) {
      return this.invalid("missing_sender", payer);
    }

    if (payload.accepted.scheme !== "exact") {
      return this.invalid("unsupported_scheme", payer);
    }

    if (!this.isConcordiumNetwork(payload.accepted.network)) {
      return this.invalid("unsupported_network", payer);
    }

    if (payload.accepted.network !== requirements.network) {
      return this.invalid("network_mismatch", payer);
    }

    let txInfo: TransactionInfo | null;
    try {
      txInfo = await this.client.getTransactionStatus(concordiumPayload.txHash);
    } catch {
      return this.invalid("transaction_lookup_failed", payer);
    }

    if (!txInfo) {
      return this.invalid("transaction_not_found", payer);
    }

    if (txInfo.status === "failed") {
      return this.invalid("transaction_failed", payer);
    }

    if (txInfo.status === "pending") {
      return this.invalid("transaction_pending", payer);
    }

    if (this.requireFinalization && txInfo.status !== "finalized") {
      return this.invalid("transaction_not_finalized", payer);
    }

    if (txInfo.sender && !this.addressEquals(txInfo.sender, concordiumPayload.sender)) {
      return this.invalid("sender_mismatch", payer);
    }

    if (!txInfo.recipient || !this.addressEquals(txInfo.recipient, requirements.payTo)) {
      return this.invalid("recipient_mismatch", payer);
    }

    const requiredAmount = this.getRequiredAmount(requirements);
    const actualAmount = BigInt(txInfo.amount || "0");

    if (actualAmount < requiredAmount) {
      return this.invalid("insufficient_amount", payer);
    }

    // Validate asset
    // Native CCD: requirements.asset is "" or undefined
    // PLT token: requirements.asset is symbol (e.g., "USDR")
    const expectedAsset = requirements.asset || "";
    const actualAsset = concordiumPayload.asset || "";

    if (expectedAsset !== actualAsset) {
      return this.invalid("asset_mismatch", payer);
    }

    return { isValid: true, payer };
  }

  /**
   * Settles a payment by verifying finalization.
   *
   * Unlike EVM where the facilitator executes the transaction,
   * for Concordium the transaction is already broadcast by the client.
   * Settlement just confirms the transaction is finalized.
   *
   * @param payload - The payment payload to settle
   * @param requirements - The payment requirements
   * @returns Promise resolving to settlement response
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const concordiumPayload = payload.payload as ExactConcordiumPayloadV2;
    const network = payload.accepted.network;
    const txHash = concordiumPayload.txHash;
    const payer = concordiumPayload.sender;

    const verifyResult = await this.verify(payload, requirements);

    if (!verifyResult.isValid) {
      return {
        success: false,
        network,
        transaction: txHash,
        payer,
        errorReason: verifyResult.invalidReason,
      };
    }

    if (this.requireFinalization) {
      try {
        const finalizedTx = await this.client.waitForFinalization(
          txHash,
          this.finalizationTimeoutMs,
        );

        if (!finalizedTx || finalizedTx.status !== "finalized") {
          return {
            success: false,
            network,
            transaction: txHash,
            payer,
            errorReason: "finalization_timeout",
          };
        }
      } catch (error) {
        return {
          success: false,
          network,
          transaction: txHash,
          payer,
          errorReason: "finalization_failed",
        };
      }
    }

    return {
      success: true,
      network,
      transaction: txHash,
      payer,
    };
  }

  private invalid(reason: string, payer: string): VerifyResponse {
    return { isValid: false, invalidReason: reason, payer };
  }

  private isConcordiumNetwork(network: string): boolean {
    return network.startsWith("ccd:");
  }

  private addressEquals(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }

  private getRequiredAmount(requirements: PaymentRequirements): bigint {
    const amount = (requirements as any).maxAmountRequired || (requirements as any).amount || "0";
    return BigInt(amount);
  }
}
