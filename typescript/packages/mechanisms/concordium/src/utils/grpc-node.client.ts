/**
 * Concordium Node Client interface and utilities for the x402 facilitator.
 *
 * The interface defines what the facilitator needs to verify/settle transactions.
 * Implementations can use @concordium/web-sdk or any other Concordium SDK.
 */

import { ConcordiumNodeClient, ConcordiumTransactionInfo } from "../exact/facilitator";

export type { ConcordiumNodeClient, ConcordiumTransactionInfo };

/**
 * Interface for Concordium gRPC client.
 * This matches the shape of ConcordiumGRPCClient from @concordium/web-sdk
 */
export interface ConcordiumGRPCClientLike {
  getBlockItemStatus(txHash: string): Promise<BlockItemStatus | null>;
  waitForTransactionFinalization?(
    txHash: string,
    timeoutMs?: number,
  ): Promise<FinalizedTransaction | null>;
}

/**
 * Block item status from Concordium node
 */
export interface BlockItemStatus {
  status: "received" | "committed" | "finalized";
  outcome?: TransactionOutcome;
}

export interface TransactionOutcome {
  blockHash?: string;
  summary?: TransactionSummary;
}

export interface TransactionSummary {
  type: string;
  sender: string;
  result: {
    outcome: "success" | "reject";
    rejectReason?: string;
  };
  transfer?: {
    to: string;
    amount: string;
  };
  // For contract calls (CIS-2 transfers)
  contractUpdate?: {
    address: string;
    receiveName: string;
    events?: string[];
  };
}

export interface FinalizedTransaction {
  blockHash: string;
  summary: TransactionSummary;
}

/**
 * Create a ConcordiumNodeClient from a gRPC client instance.
 *
 * @param grpcClient - Concordium gRPC client (from @concordium/web-sdk)
 * @returns ConcordiumNodeClient implementation
 *
 * @example
 * ```typescript
 * import { ConcordiumGRPCClient } from "@concordium/web-sdk";
 * import { createConcordiumNodeClient } from "@x402/concordium/utils";
 *
 * const grpcClient = new ConcordiumGRPCClient(
 *   "grpc.testnet.concordium.com",
 *   20000
 * );
 *
 * const nodeClient = createConcordiumNodeClient(grpcClient);
 * ```
 */
export function createConcordiumNodeClient(
  grpcClient: ConcordiumGRPCClientLike,
): ConcordiumNodeClient {
  return {
    async getTransactionStatus(txHash: string): Promise<ConcordiumTransactionInfo | null> {
      try {
        const status = await grpcClient.getBlockItemStatus(txHash);

        if (!status) {
          return null;
        }

        return mapTransactionStatus(txHash, status);
      } catch (error) {
        console.error("Error getting transaction status:", error);
        return null;
      }
    },

    async waitForFinalization(
      txHash: string,
      timeoutMs: number = 60000,
    ): Promise<ConcordiumTransactionInfo | null> {
      if (grpcClient.waitForTransactionFinalization) {
        try {
          const result = await grpcClient.waitForTransactionFinalization(txHash, timeoutMs);

          if (!result) {
            return null;
          }

          return {
            txHash,
            blockHash: result.blockHash,
            status: "finalized",
            sender: result.summary.sender,
            recipient: result.summary.transfer?.to,
            amount: result.summary.transfer?.amount,
            asset: result.summary.transfer ? "" : undefined, // Empty for native CCD
          };
        } catch (error) {
          console.error("waitForTransactionFinalization error:", error);
          // Fall back to polling
        }
      }

      // Fallback: Poll for finalization
      return this.pollForFinalization(txHash, timeoutMs);
    },

    /**
     * Poll for transaction finalization (fallback method)
     *
     * @param txHash
     * @param timeoutMs
     */
    async pollForFinalization(
      txHash: string,
      timeoutMs: number,
    ): Promise<ConcordiumTransactionInfo | null> {
      const startTime = Date.now();
      const pollInterval = 2000;

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

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      // Timeout - return last known status
      return this.getTransactionStatus(txHash);
    },
  } as ConcordiumNodeClient & { pollForFinalization: typeof pollForFinalization };
}

/**
 * Map SDK transaction status to ConcordiumTransactionInfo
 *
 * @param txHash
 * @param status
 */
function mapTransactionStatus(txHash: string, status: BlockItemStatus): ConcordiumTransactionInfo {
  const info: ConcordiumTransactionInfo = {
    txHash,
    blockHash: status.outcome?.blockHash ?? "",
    status: mapStatusEnum(status.status, status.outcome),
    sender: "",
  };

  if (status.outcome?.summary) {
    const summary = status.outcome.summary;
    info.sender = summary.sender;

    // Check for rejection
    if (summary.result.outcome === "reject") {
      info.status = "failed";
      info.error = summary.result.rejectReason;
    }

    // Extract transfer details (native CCD)
    if (summary.transfer) {
      info.recipient = summary.transfer.to;
      info.amount = summary.transfer.amount;
      info.asset = ""; // Empty string = native CCD
    }

    // Extract contract update details (CIS-2 tokens)
    if (summary.contractUpdate) {
      // For CIS-2, recipient and amount would need to be parsed from events
      // This is a simplified version
      info.asset = summary.contractUpdate.address;
    }
  }

  return info;
}

/**
 *
 * @param sdkStatus
 * @param outcome
 */
function mapStatusEnum(
  sdkStatus: "received" | "committed" | "finalized",
  outcome?: TransactionOutcome,
): ConcordiumTransactionInfo["status"] {
  // Check for rejection first
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
 * Create a mock ConcordiumNodeClient for testing.
 *
 * @param mockTransactions - Map of txHash to transaction info
 * @param options - Mock behavior options
 * @param options.delayMs
 * @param options.finalizationDelayMs
 * @param options.failureProbability
 * @returns Mock ConcordiumNodeClient
 *
 * @example
 * ```typescript
 * const mockTx: ConcordiumTransactionInfo = {
 *   txHash: "abc123",
 *   blockHash: "block456",
 *   status: "finalized",
 *   sender: "sender-address",
 *   recipient: "recipient-address",
 *   amount: "1000000",
 *   asset: "",
 * };
 *
 * const mockClient = createMockConcordiumNodeClient(
 *   new Map([["abc123", mockTx]])
 * );
 * ```
 */
export function createMockConcordiumNodeClient(
  mockTransactions: Map<string, ConcordiumTransactionInfo> = new Map(),
  options: {
    /** Simulate delay in ms */
    delayMs?: number;
    /** Simulate finalization delay in ms */
    finalizationDelayMs?: number;
    /** Simulate random failures (0-1 probability) */
    failureProbability?: number;
  } = {},
): ConcordiumNodeClient {
  const { delayMs = 0, finalizationDelayMs = 100, failureProbability = 0 } = options;

  const maybeDelay = async (ms: number) => {
    if (ms > 0) {
      await new Promise(resolve => setTimeout(resolve, ms));
    }
  };

  const maybeFail = () => {
    if (failureProbability > 0 && Math.random() < failureProbability) {
      throw new Error("Simulated network failure");
    }
  };

  return {
    async getTransactionStatus(txHash: string): Promise<ConcordiumTransactionInfo | null> {
      await maybeDelay(delayMs);
      maybeFail();
      return mockTransactions.get(txHash) || null;
    },

    async waitForFinalization(
      txHash: string,
      _timeoutMs?: number,
    ): Promise<ConcordiumTransactionInfo | null> {
      await maybeDelay(finalizationDelayMs);
      maybeFail();

      const tx = mockTransactions.get(txHash);
      if (tx) {
        // Simulate finalization by returning with finalized status
        return { ...tx, status: "finalized" };
      }
      return null;
    },
  };
}

/**
 * Helper to create a mock transaction for testing
 *
 * @param overrides
 */
export function createMockTransaction(
  overrides: Partial<ConcordiumTransactionInfo> = {},
): ConcordiumTransactionInfo {
  return {
    txHash: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    blockHash: `block-${Date.now()}`,
    status: "finalized",
    sender: "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN",
    recipient: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
    amount: "1000000", // 1 CCD in microCCD
    asset: "", // Native CCD
    ...overrides,
  };
}
