/**
 * Example implementation of ConcordiumNodeClient using @concordium/node-sdk
 *
 * This file shows how to create a node client adapter for the x402 facilitator.
 * You'll need to install @concordium/node-sdk and @concordium/common-sdk
 */

import { ConcordiumNodeClient, ConcordiumTransactionInfo } from "../exact/facilitator";

/**
 * Example: Create a ConcordiumNodeClient from the official Concordium SDK
 *
 * @example
 * ```typescript
 * import { ConcordiumGRPCClient } from "@concordium/node-sdk";
 * import { createConcordiumNodeClient } from "@x402/concordium/utils/node-client";
 *
 * const grpcClient = new ConcordiumGRPCClient(
 *   "node.testnet.concordium.com",
 *   20000
 * );
 *
 * const nodeClient = createConcordiumNodeClient(grpcClient);
 * ```
 */
export function createConcordiumNodeClient(
  // This would be ConcordiumGRPCClient from @concordium/node-sdk
  grpcClient: ConcordiumGRPCClientLike,
): ConcordiumNodeClient {
  return {
    async getTransactionStatus(txHash: string): Promise<ConcordiumTransactionInfo | null> {
      try {
        const status = await grpcClient.getBlockItemStatus(txHash);

        if (!status) {
          return null;
        }

        // Map the SDK response to our interface
        return mapTransactionStatus(txHash, status);
      } catch (error) {
        console.error("Error getting transaction status:", error);
        return null;
      }
    },

    async waitForFinalization(
      txHash: string,
      timeoutMs: number = 60000
    ): Promise<ConcordiumTransactionInfo | null> {
      const startTime = Date.now();
      const pollInterval = 2000; // 2 seconds

      while (Date.now() - startTime < timeoutMs) {
        const status = await this.getTransactionStatus(txHash);

        if (!status) {
          return null;
        }

        if (status.status === "finalized") {
          return status;
        }

        if (status.status === "failed") {
          return status;
        }

        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      // Timeout - return last known status
      return this.getTransactionStatus(txHash);
    },
  };
}

/**
 * Type representing the minimal interface needed from ConcordiumGRPCClient
 */
interface ConcordiumGRPCClientLike {
  getBlockItemStatus(txHash: string): Promise<BlockItemStatus | null>;
}

/**
 * Simplified type for block item status from SDK
 */
interface BlockItemStatus {
  status: "received" | "committed" | "finalized";
  outcome?: TransactionOutcome;
}

interface TransactionOutcome {
  summary?: TransactionSummary;
}

interface TransactionSummary {
  type: string;
  sender: string;
  result: {
    outcome: "success" | "reject";
    rejectReason?: string;
  };
  // For transfer transactions
  transfer?: {
    to: string;
    amount: string;
  };
}

/**
 * Map SDK transaction status to our interface
 */
function mapTransactionStatus(
  txHash: string,
  status: BlockItemStatus,
): ConcordiumTransactionInfo {
  const baseInfo: ConcordiumTransactionInfo = {
    txHash,
    blockHash: "",
    status: mapStatus(status.status, status.outcome),
    sender: "",
  };

  if (status.outcome?.summary) {
    const summary = status.outcome.summary;
    baseInfo.sender = summary.sender;

    if (summary.result.outcome === "reject") {
      baseInfo.status = "failed";
      baseInfo.error = summary.result.rejectReason;
    }

    // Extract transfer details if available
    if (summary.transfer) {
      baseInfo.recipient = summary.transfer.to;
      baseInfo.amount = summary.transfer.amount;
      baseInfo.asset = ""; // Empty for native CCD
    }
  }

  return baseInfo;
}

function mapStatus(
  sdkStatus: "received" | "committed" | "finalized",
  outcome?: TransactionOutcome,
): ConcordiumTransactionInfo["status"] {
  if (outcome?.summary?.result.outcome === "reject") {
    return "failed";
  }

  switch (sdkStatus) {
    case "received":
      return "pending";
    case "committed":
      return "committed";
    case "finalized":
      return "finalized";
    default:
      return "pending";
  }
}

/**
 * Mock implementation for testing
 */
export function createMockConcordiumNodeClient(
  mockTransactions: Map<string, ConcordiumTransactionInfo> = new Map(),
): ConcordiumNodeClient {
  return {
    async getTransactionStatus(txHash: string): Promise<ConcordiumTransactionInfo | null> {
      return mockTransactions.get(txHash) || null;
    },

    async waitForFinalization(
      txHash: string,
      _timeoutMs?: number,
    ): Promise<ConcordiumTransactionInfo | null> {
      const tx = mockTransactions.get(txHash);
      if (tx) {
        // Simulate finalization
        return { ...tx, status: "finalized" };
      }
      return null;
    },
  };
}
