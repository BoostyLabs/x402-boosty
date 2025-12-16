import { describe, it, expect, beforeEach, vi } from "vitest";
import { x402Client } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer, FacilitatorClient } from "@x402/core/server";
import {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from "@x402/core/types";
import { ExactConcordiumScheme as ClientScheme } from "../../src/exact/client/scheme";
import { ExactConcordiumScheme as ServerScheme } from "../../src/exact/server/scheme";
import { ExactConcordiumScheme as FacilitatorScheme } from "../../src/exact/facilitator/scheme";
import {
  createMockConcordiumNodeClient,
  createMockTransaction,
} from "../../src/utils/grpc-node.client";

const TESTNET = "ccd:4221332d34e1694168c2a0c0b3fd0f27";
const MAINNET = "ccd:9dd9ca4d19e9393877d2c44b70f89acb";
const CLIENT_ADDRESS = "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN";
const MERCHANT_ADDRESS = "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW";

class MockFacilitatorClient implements FacilitatorClient {
  readonly scheme = "exact";
  readonly network: string;
  readonly x402Version = 2;

  constructor(
    private facilitator: x402Facilitator,
    network: string = TESTNET,
  ) {
    this.network = network;
  }

  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.facilitator.verify(payload, requirements);
  }

  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return this.facilitator.settle(payload, requirements);
  }

  getSupported(): Promise<SupportedResponse> {
    return Promise.resolve(this.facilitator.getSupported());
  }
}

describe("Concordium Integration", () => {
  describe("Native CCD Payments", () => {
    let client: x402Client;
    let server: x402ResourceServer;
    let facilitator: x402Facilitator;
    let txHash: string;

    beforeEach(async () => {
      txHash = `tx-${Date.now()}`;

      const mockTx = createMockTransaction({
        txHash,
        sender: CLIENT_ADDRESS,
        recipient: MERCHANT_ADDRESS,
        amount: "1000000",
        asset: "",
        status: "finalized",
      });

      const clientScheme = new ClientScheme({
        createAndBroadcastTransaction: vi.fn().mockResolvedValue({
          txHash,
          sender: CLIENT_ADDRESS,
        }),
      });
      client = new x402Client().register(TESTNET, clientScheme);

      const mockNodeClient = createMockConcordiumNodeClient(new Map([[txHash, mockTx]]));
      const facilitatorScheme = new FacilitatorScheme({
        nodeClient: mockNodeClient,
        requireFinalization: true,
      });
      facilitator = new x402Facilitator().register(TESTNET, facilitatorScheme);

      const facilitatorClient = new MockFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClient);
      server.register(TESTNET, new ServerScheme());
      await server.initialize();
    });

    it("should complete full payment flow", async () => {
      const accepts = [
        {
          scheme: "exact",
          network: TESTNET,
          amount: "1000000",
          asset: "",
          payTo: MERCHANT_ADDRESS,
          maxTimeoutSeconds: 300,
          extra: {},
        },
      ];
      const resource = { url: "https://test.com", description: "Test", mimeType: "text/plain" };
      const paymentRequired = server.createPaymentRequiredResponse(accepts, resource);

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.x402Version).toBe(2);
      expect(paymentPayload.payload.txHash).toBe(txHash);

      const matched = server.findMatchingRequirements(accepts, paymentPayload);
      const verifyResult = await server.verifyPayment(paymentPayload, matched!);
      expect(verifyResult.isValid).toBe(true);

      const settleResult = await server.settlePayment(paymentPayload, matched!);
      expect(settleResult.success).toBe(true);
      expect(settleResult.transaction).toBe(txHash);
    });
  });

  describe("Payment Validation", () => {
    const createFacilitator = (txOverrides: Partial<ReturnType<typeof createMockTransaction>>) => {
      const mockTx = createMockTransaction({
        txHash: "test-tx",
        sender: CLIENT_ADDRESS,
        recipient: MERCHANT_ADDRESS,
        amount: "1000000",
        asset: "",
        status: "finalized",
        ...txOverrides,
      });
      const mockNodeClient = createMockConcordiumNodeClient(new Map([["test-tx", mockTx]]));
      return new x402Facilitator().register(
        TESTNET,
        new FacilitatorScheme({ nodeClient: mockNodeClient, requireFinalization: true }),
      );
    };

    const createPayload = (overrides: Partial<PaymentRequirements> = {}): PaymentPayload => ({
      x402Version: 2,
      payload: { txHash: "test-tx", sender: CLIENT_ADDRESS },
      accepted: {
        scheme: "exact",
        network: TESTNET,
        amount: "1000000",
        asset: "",
        payTo: MERCHANT_ADDRESS,
        maxTimeoutSeconds: 300,
        extra: {},
        ...overrides,
      },
      resource: { url: "", description: "", mimeType: "" },
    });

    it("should reject insufficient amount", async () => {
      const facilitator = createFacilitator({ amount: "500000" });
      const payload = createPayload();

      const result = await facilitator.verify(payload, payload.accepted);
      expect(result.isValid).toBe(false);
    });

    it("should reject wrong recipient", async () => {
      const facilitator = createFacilitator({ recipient: "WrongAddress" });
      const payload = createPayload();

      const result = await facilitator.verify(payload, payload.accepted);
      expect(result.isValid).toBe(false);
    });

    it("should reject wrong asset", async () => {
      const facilitator = createFacilitator({ asset: "9390:0:" });
      const payload = createPayload();

      const result = await facilitator.verify(payload, payload.accepted);
      expect(result.isValid).toBe(false);
    });

    it("should reject failed transaction", async () => {
      const facilitator = createFacilitator({ status: "failed" });
      const payload = createPayload();

      const result = await facilitator.verify(payload, payload.accepted);
      expect(result.isValid).toBe(false);
    });

    it("should reject transaction not found", async () => {
      const mockNodeClient = createMockConcordiumNodeClient(new Map());
      const facilitator = new x402Facilitator().register(
        TESTNET,
        new FacilitatorScheme({ nodeClient: mockNodeClient, requireFinalization: true }),
      );
      const payload = createPayload();

      const result = await facilitator.verify(payload, payload.accepted);
      expect(result.isValid).toBe(false);
    });

    it("should accept amount greater than required", async () => {
      const facilitator = createFacilitator({ amount: "2000000" });
      const payload = createPayload();

      const result = await facilitator.verify(payload, payload.accepted);
      expect(result.isValid).toBe(true);
    });
  });

  describe("CIS-2 Token Payments", () => {
    it("should verify CIS-2 token payment", async () => {
      const mockTx = createMockTransaction({
        txHash: "cis2-tx",
        sender: CLIENT_ADDRESS,
        recipient: MERCHANT_ADDRESS,
        amount: "5000000",
        asset: "9390:0:",
        status: "finalized",
      });
      const mockNodeClient = createMockConcordiumNodeClient(new Map([["cis2-tx", mockTx]]));
      const facilitator = new x402Facilitator().register(
        TESTNET,
        new FacilitatorScheme({ nodeClient: mockNodeClient, requireFinalization: true }),
      );

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: { txHash: "cis2-tx", sender: CLIENT_ADDRESS },
        accepted: {
          scheme: "exact",
          network: TESTNET,
          amount: "5000000",
          asset: "9390:0:",
          payTo: MERCHANT_ADDRESS,
          maxTimeoutSeconds: 300,
          extra: {},
        },
        resource: { url: "", description: "", mimeType: "" },
      };

      const result = await facilitator.verify(payload, payload.accepted);
      expect(result.isValid).toBe(true);
    });
  });

  describe("Multi-Network Support", () => {
    it("should support mainnet", async () => {
      const mockTx = createMockTransaction({
        txHash: "mainnet-tx",
        sender: CLIENT_ADDRESS,
        recipient: MERCHANT_ADDRESS,
        amount: "1000000",
        asset: "",
        status: "finalized",
      });
      const mockNodeClient = createMockConcordiumNodeClient(new Map([["mainnet-tx", mockTx]]));
      const facilitator = new x402Facilitator().register(
        MAINNET,
        new FacilitatorScheme({ nodeClient: mockNodeClient, requireFinalization: true }),
      );

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: { txHash: "mainnet-tx", sender: CLIENT_ADDRESS },
        accepted: {
          scheme: "exact",
          network: MAINNET,
          amount: "1000000",
          asset: "",
          payTo: MERCHANT_ADDRESS,
          maxTimeoutSeconds: 300,
          extra: {},
        },
        resource: { url: "", description: "", mimeType: "" },
      };

      const result = await facilitator.verify(payload, payload.accepted);
      expect(result.isValid).toBe(true);
    });
  });
});
