import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { PaymentPayloadV1, PaymentRequirementsV1 } from "@x402/core/types/v1";
import { ConcordiumNodeClient, ConcordiumTransactionInfo, ExactConcordiumSchemeConfig } from "../../facilitator/scheme";
import { ExactConcordiumPayloadV1 } from "../../../types";

/**
 * Concordium facilitator implementation for the Exact payment scheme (V1).
 *
 * The facilitator verifies that the client-broadcast transaction exists on-chain
 * and meets the payment requirements.
 */
export class ExactConcordiumSchemeV1 implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  private readonly config: Required<ExactConcordiumSchemeConfig>;

  constructor(config: ExactConcordiumSchemeConfig) {
    this.config = {
      nodeClient: config.nodeClient,
      requireFinalization: config.requireFinalization ?? true,
      finalizationTimeoutMs: config.finalizationTimeoutMs ?? 60000,
    };
  }

  getExtra(_: string): Record<string, unknown> | undefined {
    return undefined;
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const payloadV1 = payload as unknown as PaymentPayloadV1;
    const requirementsV1 = requirements as unknown as PaymentRequirementsV1;
    const concordiumPayload = payload.payload as ExactConcordiumPayloadV1;

    if (payloadV1.scheme !== "exact" || requirementsV1.scheme !== "exact") {
      return {
        isValid: false,
        invalidReason: "unsupported_scheme",
        payer: concordiumPayload.sender,
      };
    }

    if (payloadV1.network !== requirementsV1.network) {
      return {
        isValid: false,
        invalidReason: "network_mismatch",
        payer: concordiumPayload.sender,
      };
    }

    let txInfo: ConcordiumTransactionInfo | null;
    try {
      txInfo = await this.config.nodeClient.getTransactionStatus(concordiumPayload.txHash);
    } catch (error) {
      console.error("Failed to get transaction status:", error);
      return {
        isValid: false,
        invalidReason: "transaction_lookup_failed",
        payer: concordiumPayload.sender,
      };
    }

    if (!txInfo) {
      return {
        isValid: false,
        invalidReason: "transaction_not_found",
        payer: concordiumPayload.sender,
      };
    }

    if (txInfo.status === "failed") {
      return {
        isValid: false,
        invalidReason: "transaction_failed",
        payer: concordiumPayload.sender,
      };
    }

    if (txInfo.status === "pending") {
      return {
        isValid: false,
        invalidReason: "transaction_pending",
        payer: concordiumPayload.sender,
      };
    }

    if (this.config.requireFinalization && txInfo.status !== "finalized") {
      return {
        isValid: false,
        invalidReason: "transaction_not_finalized",
        payer: concordiumPayload.sender,
      };
    }

    if (txInfo.sender && txInfo.sender.toLowerCase() !== concordiumPayload.sender.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: "sender_mismatch",
        payer: concordiumPayload.sender,
      };
    }

    if (txInfo.recipient && txInfo.recipient.toLowerCase() !== requirementsV1.payTo.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: "recipient_mismatch",
        payer: concordiumPayload.sender,
      };
    }

    if (!txInfo.amount || BigInt(txInfo.amount) < BigInt(requirementsV1.maxAmountRequired)) {
      return {
        isValid: false,
        invalidReason: "insufficient_amount",
        payer: concordiumPayload.sender,
      };
    }

    const expectedAsset = requirementsV1.asset || "";
    const actualAsset = txInfo.asset || "";
    if (expectedAsset !== actualAsset) {
      return {
        isValid: false,
        invalidReason: "asset_mismatch",
        payer: concordiumPayload.sender,
      };
    }

    return {
      isValid: true,
      invalidReason: undefined,
      payer: concordiumPayload.sender,
    };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const payloadV1 = payload as unknown as PaymentPayloadV1;
    const concordiumPayload = payload.payload as ExactConcordiumPayloadV1;

    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        network: payloadV1.network,
        transaction: concordiumPayload.txHash,
        errorReason: verifyResult.invalidReason ?? "invalid_payment",
        payer: concordiumPayload.sender,
      };
    }

    if (this.config.requireFinalization) {
      try {
        const finalizedTx = await this.config.nodeClient.waitForFinalization(
          concordiumPayload.txHash,
          this.config.finalizationTimeoutMs,
        );

        if (!finalizedTx || finalizedTx.status !== "finalized") {
          return {
            success: false,
            network: payloadV1.network,
            transaction: concordiumPayload.txHash,
            errorReason: "finalization_timeout",
            payer: concordiumPayload.sender,
          };
        }
      } catch (error) {
        console.error("Failed to wait for finalization:", error);
        return {
          success: false,
          network: payloadV1.network,
          transaction: concordiumPayload.txHash,
          errorReason: "finalization_failed",
          payer: concordiumPayload.sender,
        };
      }
    }

    return {
      success: true,
      network: payloadV1.network,
      transaction: concordiumPayload.txHash,
      payer: concordiumPayload.sender,
    };
  }
}
