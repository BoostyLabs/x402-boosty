import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import {
  HTTPAdapter,
  HTTPResponseInstructions,
  x402HTTPResourceServer,
  x402ResourceServer,
  FacilitatorClient,
} from "@x402/core/server";
import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from "@x402/core/types";
import { parseWallet, buildAccountSigner, AccountAddress } from "@concordium/web-sdk";
import { readFileSync } from "fs";
import { ExactConcordiumScheme as ExactConcordiumClient } from "../../src/exact/client/scheme";
import { ExactConcordiumScheme as ExactConcordiumServer } from "../../src/exact/server/scheme";
import { ExactConcordiumScheme as ExactConcordiumFacilitator } from "../../src/exact/facilitator/scheme";
import { toConcordiumFacilitatorSigner } from "../../src/signer";
import type { ClientConcordiumSigner } from "../../src/signer";
import type { ExactConcordiumPayloadV2 } from "../../src/types";
import {
  CONCORDIUM_TESTNET_CAIP2,
  getConcordiumGrpcUrl,
  parseGrpcUrl,
  getExplorerTxUrl,
} from "../../src/constants";

const CLIENT_WALLET_PATH = process.env.CONCORDIUM_CLIENT_WALLET_PATH;
const FACILITATOR_WALLET_PATH = process.env.CONCORDIUM_FACILITATOR_WALLET_PATH;
const PAY_TO_ADDRESS = process.env.CONCORDIUM_PAY_TO_ADDRESS;

if (!CLIENT_WALLET_PATH || !FACILITATOR_WALLET_PATH || !PAY_TO_ADDRESS) {
  throw new Error(
    "CONCORDIUM_CLIENT_WALLET_PATH, CONCORDIUM_FACILITATOR_WALLET_PATH, and CONCORDIUM_PAY_TO_ADDRESS " +
      "environment variables must be set for integration tests",
  );
}

/**
 * Concordium Facilitator Client wrapper.
 * Wraps the x402Facilitator for use with x402ResourceServer.
 */
class ConcordiumFacilitatorClient implements FacilitatorClient {
  readonly scheme = "exact";
  readonly network = CONCORDIUM_TESTNET_CAIP2;
  readonly x402Version = 2;

  /**
   * Creates a new ConcordiumFacilitatorClient instance.
   *
   * @param facilitator - The x402 facilitator to wrap
   */
  constructor(private readonly facilitator: x402Facilitator) {}

  /**
   * Verifies a payment payload.
   *
   * @param paymentPayload - The payment payload to verify
   * @param paymentRequirements - The payment requirements
   * @returns Promise resolving to verification response
   */
  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.facilitator.verify(paymentPayload, paymentRequirements);
  }

  /**
   * Settles a payment.
   *
   * @param paymentPayload - The payment payload to settle
   * @param paymentRequirements - The payment requirements
   * @returns Promise resolving to settlement response
   */
  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.facilitator.settle(paymentPayload, paymentRequirements);
  }

  /**
   * Gets supported payment kinds.
   *
   * @returns Promise resolving to supported response
   */
  getSupported(): Promise<SupportedResponse> {
    return Promise.resolve(this.facilitator.getSupported() as SupportedResponse);
  }
}

/**
 * Builds Concordium payment requirements for testing.
 *
 * @param payTo - The recipient address
 * @param amount - The payment amount in atomic units
 * @param feePayer - The facilitator fee payer (sponsor) account address
 * @param asset - Asset identifier ("CCD" for native)
 * @param network - The network identifier
 * @returns Payment requirements object
 */
function buildConcordiumPaymentRequirements(
  payTo: string,
  amount: string,
  feePayer: string,
  asset = "CCD",
  network: Network = CONCORDIUM_TESTNET_CAIP2,
): PaymentRequirements {
  return {
    scheme: "exact",
    network,
    asset,
    amount,
    payTo,
    maxTimeoutSeconds: 60,
    extra: { feePayer },
  };
}

/**
 * Logs the CCDExplorer URL for a finalized transaction.
 *
 * @param txHash - The transaction hash
 */
function logExplorerUrl(txHash: string): void {
  const url = getExplorerTxUrl(CONCORDIUM_TESTNET_CAIP2, txHash);
  console.log(`CCDExplorer (testnet): ${url}`);
}

let clientSigner: ClientConcordiumSigner;
let clientAddress: string;
let facilitatorAddress: string;
let facilitatorSigner: ReturnType<typeof toConcordiumFacilitatorSigner>;

describe("Concordium Integration Tests", () => {
  beforeAll(() => {
    const clientWallet = parseWallet(readFileSync(CLIENT_WALLET_PATH!, "utf8"));
    clientAddress = clientWallet.value.address;
    clientSigner = {
      accountAddress: AccountAddress.fromBase58(clientAddress),
      signer: buildAccountSigner(clientWallet),
    };

    const facilitatorWallet = parseWallet(readFileSync(FACILITATOR_WALLET_PATH!, "utf8"));
    facilitatorAddress = facilitatorWallet.value.address;
    const [host, port] = parseGrpcUrl(getConcordiumGrpcUrl(CONCORDIUM_TESTNET_CAIP2));

    facilitatorSigner = toConcordiumFacilitatorSigner(
      AccountAddress.fromBase58(facilitatorAddress).toString(),
      buildAccountSigner(facilitatorWallet),
      { host, port, useTls: true },
    );

    console.log(`Client:      ${clientAddress}`);
    console.log(`Facilitator: ${facilitatorAddress}`);
    console.log(`PayTo:       ${PAY_TO_ADDRESS}`);
    console.log(`Network:     ${CONCORDIUM_TESTNET_CAIP2}\n`);
  });

  describe("x402Client / x402ResourceServer / x402Facilitator - Concordium Flow", () => {
    let client: x402Client;
    let server: x402ResourceServer;
    let facilitatorClient: ConcordiumFacilitatorClient;

    beforeEach(async () => {
      const concordiumClient = new ExactConcordiumClient(clientSigner);
      client = new x402Client().register(CONCORDIUM_TESTNET_CAIP2, concordiumClient);

      const concordiumFacilitator = new ExactConcordiumFacilitator({
        signer: facilitatorSigner,
        requireFinalization: true,
        finalizationTimeoutMs: 90_000,
        supportedAssets: [
          { symbol: "CCD", decimals: 6 },
          { symbol: "EURR", decimals: 6 },
        ],
      });
      const facilitator = new x402Facilitator().register(
        CONCORDIUM_TESTNET_CAIP2,
        concordiumFacilitator,
      );

      facilitatorClient = new ConcordiumFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClient);
      server.register(CONCORDIUM_TESTNET_CAIP2, new ExactConcordiumServer(facilitatorAddress));
      await server.initialize();
    });

    it("should successfully verify and settle a native CCD payment", async () => {
      const accepts = [
        buildConcordiumPaymentRequirements(
          PAY_TO_ADDRESS!,
          "1000000", // 1 CCD
          facilitatorAddress,
        ),
      ];
      const resource = {
        url: "https://example.com/premium",
        description: "Premium content",
        mimeType: "application/json",
      };
      const paymentRequired = await server.createPaymentRequiredResponse(accepts, resource);

      // Client creates payment payload
      const paymentPayload = await client.createPaymentPayload(paymentRequired);

      expect(paymentPayload).toBeDefined();
      expect(paymentPayload.x402Version).toBe(2);
      expect(paymentPayload.accepted.scheme).toBe("exact");
      expect(paymentPayload.accepted.network).toBe(CONCORDIUM_TESTNET_CAIP2);

      // Verify payload structure
      const concordiumPayload = paymentPayload.payload as unknown as ExactConcordiumPayloadV2;
      expect(concordiumPayload.signedTransaction).toBeDefined();
      expect(concordiumPayload.signedTransaction.version).toBe(1);
      expect(concordiumPayload.sender).toBe(clientAddress);

      // Server verifies
      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      expect(accepted).toBeDefined();

      const verifyResponse = await server.verifyPayment(paymentPayload, accepted!);
      if (!verifyResponse.isValid) {
        console.log("Verification failed:", verifyResponse.invalidReason);
      }
      expect(verifyResponse.isValid).toBe(true);
      expect(verifyResponse.payer).toBe(clientAddress);

      // Server settles
      const settleResponse = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResponse.success).toBe(true);
      expect(settleResponse.network).toBe(CONCORDIUM_TESTNET_CAIP2);
      expect(settleResponse.transaction).toBeDefined();
      expect(settleResponse.payer).toBe(clientAddress);

      logExplorerUrl(settleResponse.transaction);
    });

    it("should successfully verify and settle a PLT token payment (EURR)", async () => {
      const accepts = [
        buildConcordiumPaymentRequirements(
          PAY_TO_ADDRESS!,
          "1", // 1 EURR (whole units)
          facilitatorAddress,
          "EURR",
        ),
      ];
      const resource = {
        url: "https://example.com/premium-eurr",
        description: "Premium content - EURR",
        mimeType: "application/json",
      };
      const paymentRequired = await server.createPaymentRequiredResponse(accepts, resource);

      const paymentPayload = await client.createPaymentPayload(paymentRequired);

      expect(paymentPayload).toBeDefined();
      expect(paymentPayload.accepted.asset).toBe("EURR");

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      expect(accepted).toBeDefined();

      const verifyResponse = await server.verifyPayment(paymentPayload, accepted!);
      if (!verifyResponse.isValid) {
        console.log("PLT verification failed:", verifyResponse.invalidReason);
      }
      expect(verifyResponse.isValid).toBe(true);

      const settleResponse = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResponse.success).toBe(true);
      expect(settleResponse.transaction).toBeDefined();

      logExplorerUrl(settleResponse.transaction);
    });

    it("should reject payment with wrong sponsor address", async () => {
      const wrongSponsor = "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN";
      const accepts = [
        buildConcordiumPaymentRequirements(PAY_TO_ADDRESS!, "1000000", wrongSponsor),
      ];
      const resource = {
        url: "https://example.com/premium",
        description: "Premium content",
        mimeType: "application/json",
      };
      const paymentRequired = await server.createPaymentRequiredResponse(accepts, resource);

      // Client fails to build the tx because the sponsor address has an invalid checksum
      await expect(client.createPaymentPayload(paymentRequired)).rejects.toThrow("checksum");
    });
  });

  describe("x402HTTPClient / x402HTTPResourceServer / x402Facilitator - Concordium Flow", () => {
    let client: x402HTTPClient;
    let httpServer: x402HTTPResourceServer;

    const routes = {
      "/api/protected": {
        accepts: {
          scheme: "exact",
          payTo: PAY_TO_ADDRESS!,
          price: "1", // 1 CCD
          network: CONCORDIUM_TESTNET_CAIP2 as Network,
        },
        description: "Access to protected API",
        mimeType: "application/json",
      },
    };

    const mockAdapter: HTTPAdapter = {
      getHeader: () => undefined,
      getMethod: () => "GET",
      getPath: () => "/api/protected",
      getUrl: () => "https://example.com/api/protected",
      getAcceptHeader: () => "application/json",
      getUserAgent: () => "TestClient/1.0",
    };

    beforeEach(async () => {
      const concordiumFacilitator = new ExactConcordiumFacilitator({
        signer: facilitatorSigner,
        requireFinalization: true,
        finalizationTimeoutMs: 90_000,
        supportedAssets: [{ symbol: "CCD", decimals: 6 }],
      });
      const facilitator = new x402Facilitator().register(
        CONCORDIUM_TESTNET_CAIP2,
        concordiumFacilitator,
      );

      const facilitatorClientWrapper = new ConcordiumFacilitatorClient(facilitator);

      const concordiumClient = new ExactConcordiumClient(clientSigner);
      const paymentClient = new x402Client().register(CONCORDIUM_TESTNET_CAIP2, concordiumClient);
      client = new x402HTTPClient(paymentClient) as x402HTTPClient;

      const resourceServer = new x402ResourceServer(facilitatorClientWrapper);
      resourceServer.register(
        CONCORDIUM_TESTNET_CAIP2,
        new ExactConcordiumServer(facilitatorAddress),
      );
      await resourceServer.initialize();

      httpServer = new x402HTTPResourceServer(resourceServer, routes);
    });

    it("middleware should successfully verify and settle a CCD payment from an HTTP client", async () => {
      const context = {
        adapter: mockAdapter,
        path: "/api/protected",
        method: "GET",
      };

      const httpProcessResult = (await httpServer.processHTTPRequest(context))!;
      expect(httpProcessResult.type).toBe("payment-error");

      const initial402Response = (
        httpProcessResult as { type: "payment-error"; response: HTTPResponseInstructions }
      ).response;

      expect(initial402Response).toBeDefined();
      expect(initial402Response.status).toBe(402);
      expect(initial402Response.headers).toBeDefined();
      expect(initial402Response.headers["PAYMENT-REQUIRED"]).toBeDefined();

      const paymentRequired = client.getPaymentRequiredResponse(
        name => initial402Response.headers[name],
        initial402Response.body,
      );
      const paymentPayload = await client.createPaymentPayload(paymentRequired);

      expect(paymentPayload).toBeDefined();
      expect(paymentPayload.accepted.scheme).toBe("exact");
      expect(paymentPayload.accepted.network).toBe(CONCORDIUM_TESTNET_CAIP2);

      const requestHeaders = await client.encodePaymentSignatureHeader(paymentPayload);

      mockAdapter.getHeader = (name: string) => {
        if (name === "PAYMENT-SIGNATURE") {
          return requestHeaders["PAYMENT-SIGNATURE"];
        }
        return undefined;
      };

      const httpProcessResult2 = await httpServer.processHTTPRequest(context);
      expect(httpProcessResult2.type).toBe("payment-verified");

      const { paymentPayload: verifiedPayload, paymentRequirements: verifiedRequirements } =
        httpProcessResult2 as {
          type: "payment-verified";
          paymentPayload: PaymentPayload;
          paymentRequirements: PaymentRequirements;
        };

      expect(verifiedPayload).toBeDefined();
      expect(verifiedRequirements).toBeDefined();

      // Settle
      const settlementResult = await httpServer.processSettlement(
        verifiedPayload,
        verifiedRequirements,
      );

      expect(settlementResult).toBeDefined();
      expect(settlementResult.success).toBe(true);

      if (settlementResult.success) {
        expect(settlementResult.headers).toBeDefined();
        expect(settlementResult.headers["PAYMENT-RESPONSE"]).toBeDefined();
        logExplorerUrl(settlementResult.transaction);
      }
    });
  });

  describe("Price Parsing Integration", () => {
    let server: x402ResourceServer;
    let concordiumServer: ExactConcordiumServer;

    beforeEach(async () => {
      const concordiumFacilitator = new ExactConcordiumFacilitator({
        signer: facilitatorSigner,
        requireFinalization: true,
        supportedAssets: [
          { symbol: "CCD", decimals: 6 },
          { symbol: "EURR", decimals: 6 },
        ],
      });
      const facilitator = new x402Facilitator().register(
        CONCORDIUM_TESTNET_CAIP2,
        concordiumFacilitator,
      );

      const facilitatorClientWrapper = new ConcordiumFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClientWrapper);

      concordiumServer = new ExactConcordiumServer(facilitatorAddress);
      concordiumServer.registerAsset(CONCORDIUM_TESTNET_CAIP2, "EURR", 6);
      server.register(CONCORDIUM_TESTNET_CAIP2, concordiumServer);
      await server.initialize();
    });

    it("should parse CCD Money formats and build payment requirements", async () => {
      const testCases = [
        { input: "10", expectedAmount: "10000000" }, // 10 CCD
        { input: "1.5", expectedAmount: "1500000" }, // 1.5 CCD
        { input: 2.5, expectedAmount: "2500000" }, // 2.5 CCD
        { input: "0.000001", expectedAmount: "1" }, // 1 microCCD
      ];

      for (const testCase of testCases) {
        const requirements = await server.buildPaymentRequirements({
          scheme: "exact",
          payTo: PAY_TO_ADDRESS!,
          price: testCase.input,
          network: CONCORDIUM_TESTNET_CAIP2 as Network,
        });

        expect(requirements).toHaveLength(1);
        expect(requirements[0].amount).toBe(testCase.expectedAmount);
        expect(requirements[0].asset).toBe(""); // native CCD
      }
    });

    it("should handle AssetAmount pass-through for PLT tokens", async () => {
      const customAsset = {
        amount: "5",
        asset: "EURR",
        extra: { foo: "bar" },
      };

      const requirements = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: PAY_TO_ADDRESS!,
        price: customAsset,
        network: CONCORDIUM_TESTNET_CAIP2 as Network,
      });

      expect(requirements).toHaveLength(1);
      expect(requirements[0].amount).toBe("5");
      expect(requirements[0].asset).toBe("EURR");
      expect(requirements[0].extra?.foo).toBe("bar");
    });

    it("should reject USD prices", async () => {
      await expect(
        server.buildPaymentRequirements({
          scheme: "exact",
          payTo: PAY_TO_ADDRESS!,
          price: "$10",
          network: CONCORDIUM_TESTNET_CAIP2 as Network,
        }),
      ).rejects.toThrow("USD prices not supported");
    });

    it("should use registerMoneyParser for custom conversion", async () => {
      concordiumServer.registerMoneyParser(async (amount, _network) => {
        if (amount > 100) {
          return {
            amount: amount.toString(),
            asset: "EURR",
            extra: { tier: "large", symbol: "EURR", decimals: 6 },
          };
        }
        return null;
      });

      const largeRequirements = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: PAY_TO_ADDRESS!,
        price: 150,
        network: CONCORDIUM_TESTNET_CAIP2 as Network,
      });

      expect(largeRequirements[0].amount).toBe("150");
      expect(largeRequirements[0].asset).toBe("EURR");
      expect(largeRequirements[0].extra?.tier).toBe("large");

      const smallRequirements = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: PAY_TO_ADDRESS!,
        price: 50,
        network: CONCORDIUM_TESTNET_CAIP2 as Network,
      });

      expect(smallRequirements[0].amount).toBe("50000000"); // 50 * 1e6 (CCD)
      expect(smallRequirements[0].asset).toBe("");
    });

    it("should support multiple MoneyParser in chain", async () => {
      concordiumServer
        .registerMoneyParser(async amount => {
          if (amount > 1000) {
            return {
              amount: amount.toString(),
              asset: "EURR",
              extra: { tier: "vip" },
            };
          }
          return null;
        })
        .registerMoneyParser(async amount => {
          if (amount > 100) {
            return {
              amount: (amount * 1e6).toString(),
              asset: "",
              extra: { tier: "premium", type: "native", symbol: "CCD", decimals: 6 },
            };
          }
          return null;
        });

      const vipReq = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: PAY_TO_ADDRESS!,
        price: 2000,
        network: CONCORDIUM_TESTNET_CAIP2 as Network,
      });
      expect(vipReq[0].extra?.tier).toBe("vip");
      expect(vipReq[0].asset).toBe("EURR");

      const premiumReq = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: PAY_TO_ADDRESS!,
        price: 500,
        network: CONCORDIUM_TESTNET_CAIP2 as Network,
      });
      expect(premiumReq[0].extra?.tier).toBe("premium");
      expect(premiumReq[0].asset).toBe("");

      const standardReq = await server.buildPaymentRequirements({
        scheme: "exact",
        payTo: PAY_TO_ADDRESS!,
        price: 50,
        network: CONCORDIUM_TESTNET_CAIP2 as Network,
      });
      expect(standardReq[0].asset).toBe("");
      expect(standardReq[0].amount).toBe("50000000");
    });

    it("should avoid floating-point rounding error", async () => {
      const testCases = [
        { input: "4.02", expectedAmount: "4020000" },
        { input: 4.02, expectedAmount: "4020000" },
      ];

      for (const testCase of testCases) {
        const requirements = await server.buildPaymentRequirements({
          scheme: "exact",
          payTo: PAY_TO_ADDRESS!,
          price: testCase.input,
          network: CONCORDIUM_TESTNET_CAIP2 as Network,
        });

        expect(requirements).toHaveLength(1);
        expect(requirements[0].amount).toBe(testCase.expectedAmount);
        expect(requirements[0].asset).toBe("");
      }
    });
  });
});
