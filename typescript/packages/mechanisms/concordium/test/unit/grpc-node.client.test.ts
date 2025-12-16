import { describe, it, expect, vi } from "vitest";
import {
  createConcordiumNodeClient,
  createMockConcordiumNodeClient,
  createMockTransaction,
  ConcordiumGRPCClientLike,
  BlockItemStatus,
} from "../../src/utils/grpc-node.client";

describe("grpc-node-client", () => {
  describe("createMockTransaction", () => {
    it("should create transaction with defaults", () => {
      const tx = createMockTransaction();

      expect(tx.txHash).toBeDefined();
      expect(tx.blockHash).toBeDefined();
      expect(tx.status).toBe("finalized");
      expect(tx.sender).toBe("3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN");
      expect(tx.recipient).toBe("4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW");
      expect(tx.amount).toBe("1000000");
      expect(tx.asset).toBe("");
    });

    it("should allow overriding fields", () => {
      const tx = createMockTransaction({
        txHash: "custom-hash",
        status: "pending",
        amount: "5000000",
      });

      expect(tx.txHash).toBe("custom-hash");
      expect(tx.status).toBe("pending");
      expect(tx.amount).toBe("5000000");
    });

    it("should generate unique txHash each time", () => {
      const tx1 = createMockTransaction();
      const tx2 = createMockTransaction();

      expect(tx1.txHash).not.toBe(tx2.txHash);
    });
  });

  describe("createMockConcordiumNodeClient", () => {
    it("should return null for unknown transaction", async () => {
      const client = createMockConcordiumNodeClient();

      const result = await client.getTransactionStatus("unknown-tx");

      expect(result).toBeNull();
    });

    it("should return transaction from map", async () => {
      const mockTx = createMockTransaction({ txHash: "known-tx" });
      const client = createMockConcordiumNodeClient(new Map([["known-tx", mockTx]]));

      const result = await client.getTransactionStatus("known-tx");

      expect(result).not.toBeNull();
      expect(result?.txHash).toBe("known-tx");
    });

    it("should simulate delay", async () => {
      const client = createMockConcordiumNodeClient(new Map(), { delayMs: 50 });

      const start = Date.now();
      await client.getTransactionStatus("any");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
    });

    it("should return finalized status from waitForFinalization", async () => {
      const mockTx = createMockTransaction({ txHash: "tx1", status: "committed" });
      const client = createMockConcordiumNodeClient(new Map([["tx1", mockTx]]));

      const result = await client.waitForFinalization("tx1");

      expect(result?.status).toBe("finalized");
    });

    it("should return null from waitForFinalization for unknown tx", async () => {
      const client = createMockConcordiumNodeClient();

      const result = await client.waitForFinalization("unknown");

      expect(result).toBeNull();
    });
  });

  describe("createConcordiumNodeClient", () => {
    it("should return null when grpc returns null", async () => {
      const mockGrpc: ConcordiumGRPCClientLike = {
        getBlockItemStatus: vi.fn().mockResolvedValue(null),
      };

      const client = createConcordiumNodeClient(mockGrpc);
      const result = await client.getTransactionStatus("tx123");

      expect(result).toBeNull();
    });

    it("should map received status to pending", async () => {
      const mockStatus: BlockItemStatus = {
        status: "received",
      };
      const mockGrpc: ConcordiumGRPCClientLike = {
        getBlockItemStatus: vi.fn().mockResolvedValue(mockStatus),
      };

      const client = createConcordiumNodeClient(mockGrpc);
      const result = await client.getTransactionStatus("tx123");

      expect(result?.status).toBe("pending");
    });

    it("should map committed status", async () => {
      const mockStatus: BlockItemStatus = {
        status: "committed",
        outcome: {
          blockHash: "block123",
          summary: {
            type: "transfer",
            sender: "sender-addr",
            result: { outcome: "success" },
          },
        },
      };
      const mockGrpc: ConcordiumGRPCClientLike = {
        getBlockItemStatus: vi.fn().mockResolvedValue(mockStatus),
      };

      const client = createConcordiumNodeClient(mockGrpc);
      const result = await client.getTransactionStatus("tx123");

      expect(result?.status).toBe("committed");
      expect(result?.sender).toBe("sender-addr");
    });

    it("should map finalized status", async () => {
      const mockStatus: BlockItemStatus = {
        status: "finalized",
        outcome: {
          blockHash: "block123",
          summary: {
            type: "transfer",
            sender: "sender-addr",
            result: { outcome: "success" },
            transfer: {
              to: "recipient-addr",
              amount: "5000000",
            },
          },
        },
      };
      const mockGrpc: ConcordiumGRPCClientLike = {
        getBlockItemStatus: vi.fn().mockResolvedValue(mockStatus),
      };

      const client = createConcordiumNodeClient(mockGrpc);
      const result = await client.getTransactionStatus("tx123");

      expect(result?.status).toBe("finalized");
      expect(result?.recipient).toBe("recipient-addr");
      expect(result?.amount).toBe("5000000");
      expect(result?.asset).toBe(""); // Native CCD
    });

    it("should map rejected transaction to failed", async () => {
      const mockStatus: BlockItemStatus = {
        status: "finalized",
        outcome: {
          blockHash: "block123",
          summary: {
            type: "transfer",
            sender: "sender-addr",
            result: {
              outcome: "reject",
              rejectReason: "Insufficient funds",
            },
          },
        },
      };
      const mockGrpc: ConcordiumGRPCClientLike = {
        getBlockItemStatus: vi.fn().mockResolvedValue(mockStatus),
      };

      const client = createConcordiumNodeClient(mockGrpc);
      const result = await client.getTransactionStatus("tx123");

      expect(result?.status).toBe("failed");
      expect(result?.error).toBe("Insufficient funds");
    });

    it("should handle contract update (CIS-2)", async () => {
      const mockStatus: BlockItemStatus = {
        status: "finalized",
        outcome: {
          blockHash: "block123",
          summary: {
            type: "update",
            sender: "sender-addr",
            result: { outcome: "success" },
            contractUpdate: {
              address: "9390",
              receiveName: "transfer",
              events: [],
            },
          },
        },
      };
      const mockGrpc: ConcordiumGRPCClientLike = {
        getBlockItemStatus: vi.fn().mockResolvedValue(mockStatus),
      };

      const client = createConcordiumNodeClient(mockGrpc);
      const result = await client.getTransactionStatus("tx123");

      expect(result?.asset).toBe("9390");
    });

    it("should handle grpc error gracefully", async () => {
      const mockGrpc: ConcordiumGRPCClientLike = {
        getBlockItemStatus: vi.fn().mockRejectedValue(new Error("Network error")),
      };

      const client = createConcordiumNodeClient(mockGrpc);
      const result = await client.getTransactionStatus("tx123");

      expect(result).toBeNull();
    });

    it("should use SDK waitForTransactionFinalization if available", async () => {
      const mockGrpc: ConcordiumGRPCClientLike = {
        getBlockItemStatus: vi.fn(),
        waitForTransactionFinalization: vi.fn().mockResolvedValue({
          blockHash: "final-block",
          summary: {
            type: "transfer",
            sender: "sender-addr",
            result: { outcome: "success" },
            transfer: { to: "recipient", amount: "1000" },
          },
        }),
      };

      const client = createConcordiumNodeClient(mockGrpc);
      const result = await client.waitForFinalization("tx123", 5000);

      expect(mockGrpc.waitForTransactionFinalization).toHaveBeenCalledWith("tx123", 5000);
      expect(result?.status).toBe("finalized");
      expect(result?.blockHash).toBe("final-block");
    });
  });
});
