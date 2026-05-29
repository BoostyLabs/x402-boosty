import { describe, expect, it, vi } from "vitest";
import { ExactConcordiumScheme as ExactConcordiumClient } from "../../src/exact/client/scheme";
import { ExactConcordiumScheme as ExactConcordiumServer } from "../../src/exact/server/scheme";
import { ExactConcordiumScheme as ExactConcordiumFacilitator } from "../../src/exact/facilitator/scheme";
import type { ClientConcordiumSigner, FacilitatorConcordiumSigner } from "../../src/signer";
import type { PaymentRequirements } from "@x402/core/types";
import type { SignableV1Transaction } from "../../src/types";

vi.mock("@concordium/web-sdk", async importOriginal => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    AccountAddress: {
      ...actual.AccountAddress,
      fromBase58: (addr: string) => ({ toString: () => addr }),
    },
  };
});

vi.mock("@concordium/web-sdk/nodejs", () => {
  class ConcordiumGRPCNodeClient {
    async getNextAccountNonce() {
      return { nonce: 1n };
    }
  }
  return {
    ConcordiumGRPCNodeClient,
    credentials: {
      createSsl: () => ({}),
      createInsecure: () => ({}),
    },
  };
});

vi.mock("@concordium/web-sdk/transactions", () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const mkBuilder = (payload: unknown) => {
    let metadata: { sender?: { toString(): string }; nonce?: unknown } | undefined;
    let sponsor: { toString(): string } | undefined;
    return {
      addMetadata(m: typeof metadata) {
        metadata = m ?? undefined;
        return this;
      },
      addSponsor(s: typeof sponsor) {
        sponsor = s ?? undefined;
        return this;
      },
      build() {
        return { payload, metadata, sponsor };
      },
    };
  };

  const Transaction = {
    transfer: ({ toAddress, amount }: { toAddress: { toString(): string }; amount: unknown }) =>
      mkBuilder({
        type: "transfer",
        toAddress: toAddress.toString(),
        amount: String(
          (amount as { microCcdAmount?: unknown })?.microCcdAmount ??
            (amount as any)?.value ??
            (amount as any) ??
            "0",
        ),
      }),
    tokenUpdate: ({
      tokenId,
      operations,
    }: {
      tokenId: { toString(): string };
      operations: string;
    }) => mkBuilder({ type: "tokenUpdate", tokenId: tokenId.toString(), operations }),
    sign: async (signable: any) => {
      const sender = signable?.metadata?.sender?.toString?.() ?? "sender";
      const nonce = Number(signable?.metadata?.nonce ?? 1);
      const sponsorAddress = signable?.sponsor?.toString?.() ?? "sponsor";

      const signed: SignableV1Transaction = {
        version: 1,
        header: {
          sender,
          nonce,
          expiry: nowSeconds() + 50,
          numSignatures: 1,
          sponsor: { address: sponsorAddress, numSignatures: 1 },
        },
        payload: signable.payload as any,
        signatures: { sender: { "0": { "0": "deadbeef" } }, sponsor: {} },
      };

      return signed as any;
    },
    toJSON: (tx: any) => tx,
    signableFromJSON: (tx: any) => tx,
    verifySignature: async () => true,
    sponsor: async (tx: any) => tx,
    finalize: (tx: any) => tx,
  };

  return { Transaction };
});

describe("Concordium exact flow (offline)", () => {
  it("builds payload, verifies, and settles for CCD", async () => {
    const payer = "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN";
    const feePayer = "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW";
    const payTo = "3kZC6mZ4m2xJHrm7C1jJQJ6kqZtE8gP2f6xUo9Zrj8qWn7aQx9";

    const clientSigner: ClientConcordiumSigner = {
      accountAddress: { toString: () => payer } as any,
      signer: {} as any,
    };

    const serverScheme = new ExactConcordiumServer(feePayer);
    const price = await serverScheme.parsePrice("1", "ccd:*");

    const baseRequirements: PaymentRequirements = {
      scheme: "exact",
      network: "ccd:*",
      payTo,
      amount: price.amount,
      asset: "CCD",
      maxTimeoutSeconds: 60,
      extra: {},
    };

    const requirements = await serverScheme.enhancePaymentRequirements(
      baseRequirements,
      { x402Version: 2, scheme: "exact", network: "ccd:*" },
      [],
    );

    expect(requirements.extra?.feePayer).toBe(feePayer);

    const clientScheme = new ExactConcordiumClient(clientSigner, {
      grpcUrl: "localhost:20000",
      useTls: false,
    });

    const { payload } = await clientScheme.createPaymentPayload(2, requirements);
    const facilitatorSigner: FacilitatorConcordiumSigner = {
      getAddress: () => feePayer,
      getAccountInfo: async () =>
        ({
          accountNonce: (payload as any).signedTransaction.header.nonce,
          accountAmount: { microCcdAmount: 10_000_000n },
        }) as any,
      addSponsorSignature: async (tx: SignableV1Transaction) => tx as any,
      submitTransaction: async () => "deadbeef",
      waitForFinalization: async () => ({
        txHash: "deadbeef",
        status: "finalized",
        sender: payer,
        recipient: payTo,
        amount: requirements.amount,
        asset: "CCD",
      }),
    };

    const facilitatorScheme = new ExactConcordiumFacilitator({ signer: facilitatorSigner });

    const paymentPayload = {
      x402Version: 2,
      accepted: { scheme: "exact", network: "ccd:*" },
      payload,
    } as any;

    const verified = await facilitatorScheme.verify(paymentPayload, requirements);
    if (!verified.isValid) {
      throw new Error(`verify failed: ${verified.invalidReason}`);
    }
    expect(verified.isValid).toBe(true);
    expect(verified.payer).toBe(payer);

    const settled = await facilitatorScheme.settle(paymentPayload, requirements);
    expect(settled.success).toBe(true);
    expect(settled.payer).toBe(payer);
    expect(settled.transaction).toBe("deadbeef");
  });
});
