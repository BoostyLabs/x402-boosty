import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { ExactConcordiumPayloadV2 } from "../../types";

/**
 * Interface for Concordium node/SDK client operations needed by the facilitator.
 * Implement this interface to connect to your Concordium node.
 */
export interface ConcordiumNodeClient {
  /**
   * Get transaction status and details from the chain.
   *
   * @param txHash - The transaction hash to look up
   * @returns Transaction details or null if not found
   */
  getTransactionStatus(txHash: string): Promise<ConcordiumTransactionInfo | null>;

  /**
   * Wait for a transaction to be finalized.
   *
   * @param txHash - The transaction hash to wait for
   * @param timeoutMs - Maximum time to wait in milliseconds
   * @returns Transaction info once finalized, or null if timeout/failed
   */
  waitForFinalization(txHash: string, timeoutMs?: number): Promise<ConcordiumTransactionInfo | null>;
}

/**
 * Transaction information returned from Concordium node
 */
export interface ConcordiumTransactionInfo {
  /** Transaction hash */
  txHash: string;
  /** Block hash where transaction was included */
  blockHash: string;
  /** Transaction status */
  status: "pending" | "committed" | "finalized" | "failed";
  /** Sender account address */
  sender: string;
  /** Recipient account address (for transfers) */
  recipient?: string;
  /** Amount transferred (in microCCD or token units) */
  amount?: string;
  /** Asset identifier (empty for native CCD) */
  asset?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Configuration for the Concordium facilitator scheme
 */
export interface ExactConcordiumSchemeConfig {
  /**
   * Concordium node client for verifying transactions
   */
  nodeClient: ConcordiumNodeClient;

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
}

/**
 * Concordium facilitator implementation for the Exact payment scheme.
 *
 * This implementation verifies that:
 * 1. The transaction exists on the Concordium chain
 * 2. The transaction is to the correct recipient
 * 3. The transaction amount is sufficient
 * 4. The transaction is finalized (or committed, based on config)
 */
export class ExactConcordiumScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  /** Concordium CAIP family */
  readonly caipFamily = "ccd:*";
  private readonly config: Required<ExactConcordiumSchemeConfig>;

  /**
   * Creates a new ExactConcordiumScheme instance for facilitator operations.
   *
   * @param config - Configuration with Concordium node client
   */
  constructor(config: ExactConcordiumSchemeConfig) {
    this.config = {
      nodeClient: config.nodeClient,
      requireFinalization: config.requireFinalization ?? true,
      finalizationTimeoutMs: config.finalizationTimeoutMs ?? 60000,
    };
  }

  /**
   * Get mechanism-specific extra data for the supported kinds endpoint.
   * For Concordium, no extra data is needed.
   *
   * @param _ - The network identifier (unused)
   * @returns undefined (Concordium has no extra data)
   */
  getExtra(_: Network): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * Concordium facilitator does not act as payer; return empty signer list.
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

    // Verify scheme matches
    if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
      return {
        isValid: false,
        invalidReason: "unsupported_scheme",
        payer: concordiumPayload.sender,
      };
    }

    // Verify network matches
    if (payload.accepted.network !== requirements.network) {
      return {
        isValid: false,
        invalidReason: "network_mismatch",
        payer: concordiumPayload.sender,
      };
    }

    // Get transaction from the chain
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

    // Verify transaction status
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

    // Check finalization requirement
    if (this.config.requireFinalization && txInfo.status !== "finalized") {
      return {
        isValid: false,
        invalidReason: "transaction_not_finalized",
        payer: concordiumPayload.sender,
      };
    }

    // Verify sender matches
    if (txInfo.sender && txInfo.sender.toLowerCase() !== concordiumPayload.sender.toLowerCase()) {
      return {
        isValid: false,
        invalidReason: "sender_mismatch",
        payer: concordiumPayload.sender,
      };
    }

    // Verify recipient matches
    if (txInfo.recipient) {
      if (txInfo.recipient.toLowerCase() !== requirements.payTo.toLowerCase()) {
        return {
          isValid: false,
          invalidReason: "recipient_mismatch",
          payer: concordiumPayload.sender,
        };
      }
    }

    // Verify amount is sufficient
    if (txInfo.amount) {
      if (BigInt(txInfo.amount) < BigInt(requirements.amount)) {
        return {
          isValid: false,
          invalidReason: "insufficient_amount",
          payer: concordiumPayload.sender,
        };
      }
    }

    // Verify asset matches (if specified)
    if (txInfo.asset !== undefined) {
      const expectedAsset = requirements.asset || "";
      const actualAsset = txInfo.asset || "";
      if (expectedAsset !== actualAsset) {
        return {
          isValid: false,
          invalidReason: "asset_mismatch",
          payer: concordiumPayload.sender,
        };
      }
    }

    return {
      isValid: true,
      invalidReason: undefined,
      payer: concordiumPayload.sender,
    };
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

    // First verify the payment
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        network: payload.accepted.network,
        transaction: concordiumPayload.txHash,
        errorReason: verifyResult.invalidReason ?? "invalid_payment",
        payer: concordiumPayload.sender,
      };
    }

    // If we require finalization and haven't verified it yet, wait for it
    if (this.config.requireFinalization) {
      try {
        const finalizedTx = await this.config.nodeClient.waitForFinalization(
          concordiumPayload.txHash,
          this.config.finalizationTimeoutMs,
        );

        if (!finalizedTx || finalizedTx.status !== "finalized") {
          return {
            success: false,
            network: payload.accepted.network,
            transaction: concordiumPayload.txHash,
            errorReason: "finalization_timeout",
            payer: concordiumPayload.sender,
          };
        }
      } catch (error) {
        console.error("Failed to wait for finalization:", error);
        return {
          success: false,
          network: payload.accepted.network,
          transaction: concordiumPayload.txHash,
          errorReason: "finalization_failed",
          payer: concordiumPayload.sender,
        };
      }
    }

    // Transaction is verified and finalized (or committed if not requiring finalization)
    return {
      success: true,
      network: payload.accepted.network,
      transaction: concordiumPayload.txHash,
      payer: concordiumPayload.sender,
    };
  }
}
