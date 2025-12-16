import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExactConcordiumScheme } from "../../../src/exact/facilitator/scheme";
import { PaymentPayload, PaymentRequirements } from "@x402/core/types";

describe("ExactConcordiumScheme (Facilitator)", () => {
  let scheme: ExactConcordiumScheme;
  let mockNodeClient: {
    getTransactionStatus: ReturnType<typeof vi.fn>;
    waitForFinalization: ReturnType<typeof vi.fn>;
  };

  const validTxInfo = {
    txHash: "abc123",
    blockHash: "block456",
    status: "finalized" as const,
    sender: "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN",
    recipient: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
    amount: "1000000",
    asset: "",
  };

  const validPayload: PaymentPayload = {
    x402Version: 2,
    payload: {
      txHash: "abc123",
      sender: "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN",
    },
    accepted: {
      scheme: "exact",
      network: "ccd:4221332d34e1694168c2a0c0b3fd0f27",
      amount: "1000000",
      asset: "",
      payTo: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
      maxTimeoutSeconds: 300,
      extra: {},
    },
    resource: { url: "", description: "", mimeType: "" },
  };

  const validRequirements: PaymentRequirements = {
    scheme: "exact",
    network: "ccd:4221332d34e1694168c2a0c0b3fd0f27",
    amount: "1000000",
    asset: "",
    payTo: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
    maxTimeoutSeconds: 300,
    extra: {},
  };

  beforeEach(() => {
    mockNodeClient = {
      getTransactionStatus: vi.fn().mockResolvedValue(validTxInfo),
      waitForFinalization: vi.fn().mockResolvedValue({ ...validTxInfo, status: "finalized" }),
    };

    scheme = new ExactConcordiumScheme({
      nodeClient: mockNodeClient,
      requireFinalization: true,
      finalizationTimeoutMs: 60000,
    });
  });

  describe("scheme property", () => {
    it("should be 'exact'", () => {
      expect(scheme.scheme).toBe("exact");
    });
  });

  describe("verify", () => {
    it("should return valid for correct payment", async () => {
      const result = await scheme.verify(validPayload, validRequirements);

      expect(result.isValid).toBe(true);
      expect(result.payer).toBe("3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN");
    });

    it("should reject wrong scheme", async () => {
      const result = await scheme.verify(
        { ...validPayload, accepted: { ...validPayload.accepted, scheme: "other" } },
        { ...validRequirements, scheme: "other" as any },
      );

      expect(result.isValid).toBe(false);
    });

    it("should reject transaction not found", async () => {
      mockNodeClient.getTransactionStatus.mockResolvedValue(null);

      const result = await scheme.verify(validPayload, validRequirements);

      expect(result.isValid).toBe(false);
    });

    it("should reject failed transaction", async () => {
      mockNodeClient.getTransactionStatus.mockResolvedValue({
        ...validTxInfo,
        status: "failed",
      });

      const result = await scheme.verify(validPayload, validRequirements);

      expect(result.isValid).toBe(false);
    });

    it("should reject insufficient amount", async () => {
      mockNodeClient.getTransactionStatus.mockResolvedValue({
        ...validTxInfo,
        amount: "500000", // Less than required
      });

      const result = await scheme.verify(validPayload, validRequirements);

      expect(result.isValid).toBe(false);
    });

    it("should reject wrong recipient", async () => {
      mockNodeClient.getTransactionStatus.mockResolvedValue({
        ...validTxInfo,
        recipient: "differentAddress",
      });

      const result = await scheme.verify(validPayload, validRequirements);

      expect(result.isValid).toBe(false);
    });

    it("should reject wrong asset", async () => {
      mockNodeClient.getTransactionStatus.mockResolvedValue({
        ...validTxInfo,
        asset: "9390:0:", // Different asset
      });

      const result = await scheme.verify(validPayload, validRequirements);

      expect(result.isValid).toBe(false);
    });

    it("should accept amount greater than required", async () => {
      mockNodeClient.getTransactionStatus.mockResolvedValue({
        ...validTxInfo,
        amount: "2000000", // More than required
      });

      const result = await scheme.verify(validPayload, validRequirements);

      expect(result.isValid).toBe(true);
    });
  });

  describe("settle", () => {
    it("should return success for valid payment", async () => {
      const result = await scheme.settle(validPayload, validRequirements);

      expect(result.success).toBe(true);
      expect(result.transaction).toBe("abc123");
      expect(result.network).toBe("ccd:4221332d34e1694168c2a0c0b3fd0f27");
    });

    it("should wait for finalization", async () => {
      await scheme.settle(validPayload, validRequirements);

      expect(mockNodeClient.waitForFinalization).toHaveBeenCalledWith("abc123", 60000);
    });

    it("should fail if finalization times out", async () => {
      mockNodeClient.waitForFinalization.mockResolvedValue(null);

      const result = await scheme.settle(validPayload, validRequirements);

      expect(result.success).toBe(false);
    });
  });
});
