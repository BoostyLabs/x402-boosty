import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { PaymentPayloadV1, PaymentRequirementsV1 } from "@x402/core/types/v1";
import type { ConcordiumClient, TransactionInfo } from "../../../client";
import type { ExactConcordiumPayloadV1 } from "../../../types";

export interface ExactConcordiumSchemeV1Config {
  /**
   * Concordium client instance.
   */
  client: ConcordiumClient;

  /**
   * Whether to wait for finalization before settling.
   * @default true
   */
  requireFinalization?: boolean;

  /**
   * Finalization timeout in milliseconds.
   * @default 60000
   */
  finalizationTimeoutMs?: number;

  /**
   * Supported assets (for /supported endpoint).
   */
  supportedAssets?: Array<{ symbol: string; decimals: number }>;
}
/**
 * Concordium facilitator V1 for exact payments.
 *
 * V1 uses PaymentPayloadV1/PaymentRequirementsV1 types.
 */
export class ExactConcordiumSchemeV1 implements SchemeNetworkFacilitator {
  readonly scheme = "exact";

  readonly caipFamily = "ccd:*";

  private readonly client: ConcordiumClient;
  private readonly requireFinalization: boolean;
  private readonly finalizationTimeoutMs: number;
  private readonly supportedAssets: Array<{ symbol: string; decimals: number }>;

  constructor(config: ExactConcordiumSchemeV1Config) {
    this.client = config.client;
    this.requireFinalization = config.requireFinalization ?? true;
    this.finalizationTimeoutMs = config.finalizationTimeoutMs ?? 60000;
    this.supportedAssets = config.supportedAssets ?? [{ symbol: "CCD", decimals: 6 }];
  }

  getExtra(_network: Network): Record<string, unknown> | undefined {
    return {
      assets: this.supportedAssets,
    };
  }

  getSigners(_network: string): string[] {
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
    const payloadV1 = payload as unknown as PaymentPayloadV1;
    const requirementsV1 = requirements as unknown as PaymentRequirementsV1;
    const ccdPayload = payloadV1.payload as ExactConcordiumPayloadV1;
    const payer = ccdPayload.sender;

    if (!ccdPayload.txHash) {
      return this.invalid("missing_tx_hash", payer);
    }

    if (!ccdPayload.sender) {
      return this.invalid("missing_sender", payer);
    }

    if (payloadV1.scheme !== "exact") {
      return this.invalid("unsupported_scheme", payer);
    }

    if (!this.isConcordiumNetwork(payloadV1.network)) {
      return this.invalid("unsupported_network", payer);
    }

    if (payloadV1.network !== requirementsV1.network) {
      return this.invalid("network_mismatch", payer);
    }

    let txInfo: TransactionInfo | null;
    try {
      txInfo = await this.client.getTransactionStatus(ccdPayload.txHash);
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

    if (txInfo.sender && !this.addressEquals(txInfo.sender, ccdPayload.sender)) {
      return this.invalid("sender_mismatch", payer);
    }

    if (!txInfo.recipient || !this.addressEquals(txInfo.recipient, requirementsV1.payTo)) {
      return this.invalid("recipient_mismatch", payer);
    }

    const requiredAmount = BigInt(requirementsV1.maxAmountRequired || "0");
    const actualAmount = BigInt(txInfo.amount || "0");

    if (actualAmount < requiredAmount) {
      return this.invalid("insufficient_amount", payer);
    }

    const expectedAsset = requirementsV1.asset || "";
    const actualAsset = ccdPayload.asset || "";
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
    const payloadV1 = payload as unknown as PaymentPayloadV1;
    const ccdPayload = payloadV1.payload as ExactConcordiumPayloadV1;
    const network = payloadV1.network;
    const txHash = ccdPayload.txHash;
    const payer = ccdPayload.sender;

    const verification = await this.verify(payload, requirements);

    if (!verification.isValid) {
      return {
        success: false,
        network,
        transaction: txHash,
        payer,
        errorReason: verification.invalidReason,
      };
    }

    if (this.requireFinalization) {
      try {
        const finalTx = await this.client.waitForFinalization(
          txHash,
          this.finalizationTimeoutMs,
        );

        if (!finalTx || finalTx.status !== "finalized") {
          return {
            success: false,
            network,
            transaction: txHash,
            payer,
            errorReason: "finalization_timeout",
          };
        }
      } catch {
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

  private invalid(reason: string, payer?: string): VerifyResponse {
    return { isValid: false, invalidReason: reason, payer };
  }

  private isConcordiumNetwork(network: string): boolean {
    return network.startsWith("ccd:");
  }

  private addressEquals(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }
}
