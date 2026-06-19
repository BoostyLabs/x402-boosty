import { describe, it, expect, vi } from "vitest";
import { ExactConcordiumScheme as ExactConcordiumServer } from "../../src/exact/server/scheme";
import { ExactConcordiumScheme as ExactConcordiumFacilitator } from "../../src/exact/facilitator/scheme";
import {
  CONCORDIUM_MAINNET_CAIP2,
  CONCORDIUM_TESTNET_CAIP2,
  CONCORDIUM_ADDRESS_REGEX,
  CCD_DECIMALS,
  MAX_EXPIRY_OFFSET_SECONDS,
  DEFAULT_FINALIZATION_TIMEOUT_MS,
  getConcordiumGrpcUrl,
  parseGrpcUrl,
  getExplorerTxUrl,
} from "../../src/index";
import type { PaymentRequirements } from "@x402/core/types";
import type { FacilitatorConcordiumSigner } from "../../src/signer";

function createMockFacilitatorSigner(
  address = "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
): FacilitatorConcordiumSigner {
  return {
    getAddress: () => address,
    getNetwork: () => "ccd:*",
    getAccountInfo: vi.fn(),
    getTokenBalance: vi.fn().mockResolvedValue(1_000_000n),
    getTokenDecimals: vi.fn().mockResolvedValue(6),
    addSponsorSignature: vi.fn(),
    submitTransaction: vi.fn(),
    waitForFinalization: vi.fn(),
  };
}

describe("@x402/concordium", () => {
  describe("exports", () => {
    it("should export scheme classes", () => {
      expect(ExactConcordiumServer).toBeDefined();
      expect(ExactConcordiumFacilitator).toBeDefined();
    });

    it("should export constants", () => {
      expect(CONCORDIUM_MAINNET_CAIP2).toBe("ccd:9dd9ca4d19e9393877d2c44b70f89acb");
      expect(CONCORDIUM_TESTNET_CAIP2).toBe("ccd:4221332d34e1694168c2a0c0b3fd0f27");
      expect(CONCORDIUM_ADDRESS_REGEX).toBeDefined();
      expect(CCD_DECIMALS).toBe(6);
      expect(MAX_EXPIRY_OFFSET_SECONDS).toBe(600);
      expect(DEFAULT_FINALIZATION_TIMEOUT_MS).toBe(60_000);
    });

    it("should export utility functions", () => {
      expect(getConcordiumGrpcUrl).toBeDefined();
      expect(parseGrpcUrl).toBeDefined();
      expect(getExplorerTxUrl).toBeDefined();
    });
  });

  describe("ExactConcordiumServer", () => {
    it("should have scheme property set to exact", () => {
      const server = new ExactConcordiumServer();
      expect(server.scheme).toBe("exact");
    });

    it("should inject feePayer from supported kind into payment requirements", async () => {
      const feePayer = "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW";
      const server = new ExactConcordiumServer();
      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: CONCORDIUM_TESTNET_CAIP2,
        asset: "CCD",
        amount: "1000000",
        payTo: "3UrcxPQeYywasrPcYUcqhvFu3SB2vBBDjj7TsaRQ431vGiczYp",
        maxTimeoutSeconds: 60,
        extra: {},
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "exact",
        network: CONCORDIUM_TESTNET_CAIP2,
        extra: { feePayer },
      };

      const enhanced = await server.enhancePaymentRequirements(requirements, supportedKind, []);
      expect(enhanced.extra?.feePayer).toBe(feePayer);
    });

    it("should leave feePayer undefined when facilitator metadata does not provide it", async () => {
      const server = new ExactConcordiumServer();
      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: CONCORDIUM_TESTNET_CAIP2,
        asset: "CCD",
        amount: "1000000",
        payTo: "3UrcxPQeYywasrPcYUcqhvFu3SB2vBBDjj7TsaRQ431vGiczYp",
        maxTimeoutSeconds: 60,
        extra: {},
      };
      const supportedKind = {
        x402Version: 2,
        scheme: "exact",
        network: CONCORDIUM_TESTNET_CAIP2,
      };

      const enhanced = await server.enhancePaymentRequirements(requirements, supportedKind, []);
      expect(enhanced.extra?.feePayer).toBeUndefined();
    });

    it("should register and retrieve PLT assets", () => {
      const server = new ExactConcordiumServer();
      server.registerAsset(CONCORDIUM_TESTNET_CAIP2, "EURR", 6);

      const asset = server.getAsset(CONCORDIUM_TESTNET_CAIP2, "EURR");
      expect(asset).toBeDefined();
      expect(asset?.symbol).toBe("EURR");
      expect(asset?.type).toBe("plt");
      expect(asset?.decimals).toBe(6);
    });

    it("should always include CCD in supported assets", () => {
      const server = new ExactConcordiumServer();
      const assets = server.getSupportedAssets(CONCORDIUM_TESTNET_CAIP2);

      expect(assets).toHaveLength(1);
      expect(assets[0].symbol).toBe("CCD");
      expect(assets[0].type).toBe("native");
    });

    it("should parse CCD price to microCCD", async () => {
      const server = new ExactConcordiumServer();
      const result = await server.parsePrice("10", CONCORDIUM_TESTNET_CAIP2);

      expect(result.amount).toBe("10000000");
      expect(result.asset).toBe("CCD");
    });

    it("should parse fractional CCD price", async () => {
      const server = new ExactConcordiumServer();
      const result = await server.parsePrice("10.5", CONCORDIUM_TESTNET_CAIP2);

      expect(result.amount).toBe("10500000");
      expect(result.asset).toBe("CCD");
    });

    it("should parse PLT asset amount", async () => {
      const server = new ExactConcordiumServer();
      server.registerAsset(CONCORDIUM_TESTNET_CAIP2, "EURR", 6);

      const result = await server.parsePrice(
        { amount: "5", asset: "EURR" },
        CONCORDIUM_TESTNET_CAIP2,
      );

      expect(result.amount).toBe("5000000");
      expect(result.asset).toBe("EURR");
    });

    it("should throw when USD price has no registered money parser", async () => {
      const server = new ExactConcordiumServer();
      await expect(server.parsePrice("$0.001", CONCORDIUM_TESTNET_CAIP2)).rejects.toThrow(
        "Cannot resolve USD-denominated price",
      );
    });

    it("should allow USD prices when a money parser is registered", async () => {
      const server = new ExactConcordiumServer();
      server
        .registerAsset(CONCORDIUM_TESTNET_CAIP2, "EURR", 6)
        .registerMoneyParser(async amount => ({
          amount: amount.toString(),
          asset: "EURR",
          extra: { type: "plt", symbol: "EURR", decimals: 6 },
        }));

      const result = await server.parsePrice("$10", CONCORDIUM_TESTNET_CAIP2);

      expect(result.amount).toBe("10");
      expect(result.asset).toBe("EURR");
    });

    it("should reject unknown assets", async () => {
      const server = new ExactConcordiumServer();
      await expect(
        server.parsePrice({ amount: "1", asset: "UNKNOWN" }, CONCORDIUM_TESTNET_CAIP2),
      ).rejects.toThrow("Unknown asset");
    });
  });

  describe("ExactConcordiumFacilitator", () => {
    it("should return sponsorAddress in getExtra", () => {
      const mockSigner = createMockFacilitatorSigner();
      const facilitator = new ExactConcordiumFacilitator({ signer: mockSigner });
      const extra = facilitator.getExtra(CONCORDIUM_TESTNET_CAIP2);

      expect(extra).toBeDefined();
      expect(extra?.feePayer).toBe("4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW");
    });

    it("should return signer address in getSigners", () => {
      const mockSigner = createMockFacilitatorSigner();
      const facilitator = new ExactConcordiumFacilitator({ signer: mockSigner });
      const signers = facilitator.getSigners(CONCORDIUM_TESTNET_CAIP2);

      expect(signers).toEqual(["4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW"]);
    });

    it("should reject missing payload", async () => {
      const mockSigner = createMockFacilitatorSigner();
      const facilitator = new ExactConcordiumFacilitator({ signer: mockSigner });

      const result = await facilitator.verify(
        {
          x402Version: 2,
          accepted: { scheme: "exact", network: CONCORDIUM_TESTNET_CAIP2 } as any,
          payload: null as any,
        },
        {
          scheme: "exact",
          network: CONCORDIUM_TESTNET_CAIP2,
          amount: "1000000",
          asset: "CCD",
          payTo: "3kBx",
          maxTimeoutSeconds: 60,
          extra: {},
        },
      );

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("missing_payload");
    });

    it("should reject wrong transaction version", async () => {
      const mockSigner = createMockFacilitatorSigner();
      const facilitator = new ExactConcordiumFacilitator({ signer: mockSigner });

      const result = await facilitator.verify(
        {
          x402Version: 2,
          accepted: { scheme: "exact", network: CONCORDIUM_TESTNET_CAIP2 } as any,
          payload: {
            signedTransaction: {
              version: 0 as any,
              header: {
                sender: "3kBx",
                expiry: 9999999999,
                sponsor: { account: "4Fmi", numSignatures: 1 },
                numSignatures: 1,
                nonce: 1,
              },
              payload: { transactionType: "transfer", toAddress: "4Fmi", amount: "1000000" },
              signatures: { sender: { "0": { "0": "sig" } }, sponsor: {} },
            },
            sender: "3kBx",
          } as any,
        },
        {
          scheme: "exact",
          network: CONCORDIUM_TESTNET_CAIP2,
          amount: "1000000",
          asset: "CCD",
          payTo: "4Fmi",
          maxTimeoutSeconds: 60,
          extra: { feePayer: "4Fmi" },
        },
      );

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("invalid_transaction_version");
    });

    it("should reject sponsor mismatch", async () => {
      const mockSigner = createMockFacilitatorSigner();
      const facilitator = new ExactConcordiumFacilitator({ signer: mockSigner });

      const result = await facilitator.verify(
        {
          x402Version: 2,
          accepted: { scheme: "exact", network: CONCORDIUM_TESTNET_CAIP2 } as any,
          payload: {
            signedTransaction: {
              version: 1,
              header: {
                sender: "3UrcxPQeYywasrPcYUcqhvFu3SB2vBBDjj7TsaRQ431vGiczYp",
                expiry: Math.floor(Date.now() / 1000) + 300,
                sponsor: {
                  account: "WRONG_SPONSOR_ADDRESS_HERE_12345678901234567890",
                  numSignatures: 1,
                },
                numSignatures: 1,
                nonce: 1,
              },
              payload: { transactionType: "transfer", toAddress: "4Fmi", amount: "1000000" },
              signatures: { sender: { "0": { "0": "sig" } }, sponsor: {} },
            },
          } as any,
        },
        {
          scheme: "exact",
          network: CONCORDIUM_TESTNET_CAIP2,
          amount: "1000000",
          asset: "CCD",
          payTo: "4Fmi",
          maxTimeoutSeconds: 60,
          extra: { feePayer: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW" },
        },
      );

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("sponsor_mismatch");
    });

    it("should reject expired transactions", async () => {
      const mockSigner = createMockFacilitatorSigner();
      const facilitator = new ExactConcordiumFacilitator({ signer: mockSigner });

      const result = await facilitator.verify(
        {
          x402Version: 2,
          accepted: { scheme: "exact", network: CONCORDIUM_TESTNET_CAIP2 } as any,
          payload: {
            signedTransaction: {
              version: 1,
              header: {
                sender: "3UrcxPQeYywasrPcYUcqhvFu3SB2vBBDjj7TsaRQ431vGiczYp",
                expiry: 1000000000, // well in the past
                sponsor: {
                  account: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
                  numSignatures: 1,
                },
                numSignatures: 1,
                nonce: 1,
              },
              payload: { transactionType: "transfer", toAddress: "4Fmi", amount: "1000000" },
              signatures: { sender: { "0": { "0": "sig" } }, sponsor: {} },
            },
          } as any,
        },
        {
          scheme: "exact",
          network: CONCORDIUM_TESTNET_CAIP2,
          amount: "1000000",
          asset: "CCD",
          payTo: "4Fmi",
          maxTimeoutSeconds: 60,
          extra: { feePayer: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW" },
        },
      );

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain("transaction_expired");
    });

    it("should support multiple facilitator signers for feePayer selection", () => {
      const facilitator = new ExactConcordiumFacilitator({
        signer: [
          createMockFacilitatorSigner("4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW"),
          createMockFacilitatorSigner("3wQjKH4tPa3xwM4gK5M9f7Q7mTzRrJ7z8Yw7XhXo8v9eP4JpJ8"),
        ],
      });

      expect(facilitator.getSigners(CONCORDIUM_TESTNET_CAIP2)).toEqual([
        "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
        "3wQjKH4tPa3xwM4gK5M9f7Q7mTzRrJ7z8Yw7XhXo8v9eP4JpJ8",
      ]);
      expect(facilitator.getExtra(CONCORDIUM_TESTNET_CAIP2)?.feePayer).toBeDefined();
    });
  });
});
