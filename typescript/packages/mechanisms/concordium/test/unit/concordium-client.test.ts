import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConcordiumClient, TransactionStatusEnum } from "../../src/client";

// Mock gRPC client
const mockGrpcClient = {
  getBlockItemStatus: vi.fn(),
  invokeContract: vi.fn(),
  close: vi.fn(),
};

// Mock SDK
vi.mock("@concordium/web-sdk/nodejs", () => ({
  ConcordiumGRPCNodeClient: vi.fn(() => mockGrpcClient),
  credentials: {
    createSsl: vi.fn(),
    createInsecure: vi.fn(),
  },
}));

vi.mock("@concordium/web-sdk", () => ({
  TransactionHash: { fromHexString: vi.fn((h) => h) },
  ContractAddress: { create: vi.fn((i, s) => ({ index: i, subindex: s })) },
  ReceiveName: { fromString: vi.fn((n) => n) },
  Parameter: { fromBuffer: vi.fn((b) => b) },
}));

vi.mock("../config", () => ({
  getChainConfig: vi.fn((network) =>
    network === "concordium-testnet"
      ? { grpcUrl: "grpc.testnet.concordium.com:20000" }
      : null
  ),
}));

describe("ConcordiumClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fromNetwork", () => {
    it("creates client from valid network", () => {
      expect(ConcordiumClient.fromNetwork("concordium-testnet")).toBeInstanceOf(ConcordiumClient);
    });

    it("throws for unknown network", () => {
      expect(() => ConcordiumClient.fromNetwork("unknown")).toThrow("Unknown network");
    });
  });

  describe("getTransactionStatus", () => {
    it("returns pending when no status", async () => {
      mockGrpcClient.getBlockItemStatus.mockResolvedValue(null);

      const client = new ConcordiumClient({ host: "localhost" });
      const result = await client.getTransactionStatus("a".repeat(64));

      expect(result.status).toBe("pending");
    });

    it("returns finalized with transfer data", async () => {
      mockGrpcClient.getBlockItemStatus.mockResolvedValue({
        status: TransactionStatusEnum.Finalized,
        outcome: {
          summary: {
            sender: { address: "sender" },
            transfer: {
              to: { address: "recipient" },
              amount: { microCcdAmount: 1000000n },
            },
          },
        },
      });

      const client = new ConcordiumClient({ host: "localhost" });
      const result = await client.getTransactionStatus("b".repeat(64));

      expect(result.status).toBe("finalized");
      expect(result.sender).toBe("sender");
      expect(result.recipient).toBe("recipient");
      expect(result.amount).toBe("1000000");
    });
  });

  describe("verifyPayment", () => {
    it("returns valid for correct payment", async () => {
      mockGrpcClient.getBlockItemStatus.mockResolvedValue({
        status: TransactionStatusEnum.Finalized,
        outcome: {
          summary: {
            sender: { address: "sender" },
            transfer: {
              to: { address: "recipient" },
              amount: { microCcdAmount: 1000000n },
            },
          },
        },
      });

      const client = new ConcordiumClient({ host: "localhost" });
      const result = await client.verifyPayment("c".repeat(64), {
        recipient: "recipient",
        minAmount: 1000000n,
      });

      expect(result.valid).toBe(true);
    });

    it("returns recipient_mismatch for wrong recipient", async () => {
      mockGrpcClient.getBlockItemStatus.mockResolvedValue({
        status: TransactionStatusEnum.Finalized,
        outcome: {
          summary: {
            sender: { address: "sender" },
            transfer: {
              to: { address: "wrong" },
              amount: { microCcdAmount: 1000000n },
            },
          },
        },
      });

      const client = new ConcordiumClient({ host: "localhost" });
      const result = await client.verifyPayment("d".repeat(64), {
        recipient: "expected",
        minAmount: 1000000n,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("recipient_mismatch");
    });

    it("returns insufficient_amount for low amount", async () => {
      mockGrpcClient.getBlockItemStatus.mockResolvedValue({
        status: TransactionStatusEnum.Finalized,
        outcome: {
          summary: {
            sender: { address: "sender" },
            transfer: {
              to: { address: "recipient" },
              amount: { microCcdAmount: 500000n },
            },
          },
        },
      });

      const client = new ConcordiumClient({ host: "localhost" });
      const result = await client.verifyPayment("e".repeat(64), {
        recipient: "recipient",
        minAmount: 1000000n,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("insufficient_amount");
    });
  });

  describe("invokeContract", () => {
    it("returns success with return value", async () => {
      mockGrpcClient.invokeContract.mockResolvedValue({
        tag: "success",
        returnValue: { buffer: new Uint8Array([1, 2, 3]) },
      });

      const client = new ConcordiumClient({ host: "localhost" });
      const result = await client.invokeContract(
        { index: 100n, subindex: 0n },
        "contract.view",
      );

      expect(result.success).toBe(true);
      expect(result.returnValue).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("returns failure with error", async () => {
      mockGrpcClient.invokeContract.mockResolvedValue({
        tag: "failure",
        reason: "Rejected",
      });

      const client = new ConcordiumClient({ host: "localhost" });
      const result = await client.invokeContract(
        { index: 100n, subindex: 0n },
        "contract.fail",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Rejected");
    });
  });

  describe("close", () => {
    it("closes without error", async () => {
      mockGrpcClient.getBlockItemStatus.mockResolvedValue(null);

      const client = new ConcordiumClient({ host: "localhost" });
      await client.getTransactionStatus("f".repeat(64));

      expect(() => client.close()).not.toThrow();
      expect(mockGrpcClient.close).toHaveBeenCalled();
    });
  });
});
