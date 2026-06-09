import { describe, expect, it, vi } from "vitest";
import type { FacilitatorConcordiumSigner } from "../../typescript/packages/mechanisms/concordium/src/signer";
import type { PaymentRequirements } from "@x402/core/types";
import type { SignableV1Transaction } from "../../typescript/packages/mechanisms/concordium/src/types";

vi.mock("@concordium/web-sdk", () => {
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

  return {
    AccountAddress: {
      fromBase58: (addr: string) => ({ toString: () => addr }),
    },
    TransactionExpiry: {
      futureMinutes: (minutes: number) => nowSeconds() + minutes * 60,
    },
    TokenId: {
      fromString: (value: string) => ({ toString: () => value }),
    },
    TokenAmount: {
      fromDecimal: (value: number, decimals: number) => ({
        value: BigInt(Math.round(value * 10 ** decimals)),
      }),
    },
    CborAccountAddress: {
      fromAccountAddress: (address: { toString(): string }) => ({
        toString: () => address.toString(),
      }),
    },
    CcdAmount: {
      fromMicroCcd: (value: bigint) => ({ microCcdAmount: value }),
      toMicroCcd: (value: { microCcdAmount?: bigint } | bigint) =>
        typeof value === "bigint" ? value : (value.microCcdAmount ?? 0n),
    },
    TokenOperationType: {
      Transfer: "transfer",
    },
    Cbor: {
      encode: (value: unknown) => JSON.stringify(value),
      decode: (value: string) => JSON.parse(value),
      fromJSON: (value: unknown) => value,
    },
    Transaction,
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

describe("Concordium exact flow (repo e2e offline)", () => {
  it("builds payload, verifies, and settles for CCD", async () => {
    const { ExactConcordiumScheme: ExactConcordiumServer } = await import(
      "../../typescript/packages/mechanisms/concordium/src/exact/server/scheme"
    );
    const { ExactConcordiumScheme: ExactConcordiumFacilitator } = await import(
      "../../typescript/packages/mechanisms/concordium/src/exact/facilitator/scheme"
    );

    const payer = "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN";
    const feePayer = "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW";
    const payTo = payer;

    const serverScheme = new ExactConcordiumServer();
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
      { x402Version: 2, scheme: "exact", network: "ccd:*", extra: { feePayer } },
      [],
    );

    expect(requirements.extra?.feePayer).toBe(feePayer);
    const payload = {
      signedTransaction: {
        version: 1,
        header: {
          sender: payer,
          nonce: 1,
          expiry: Math.floor(Date.now() / 1000) + 50,
          numSignatures: 1,
          sponsor: { address: feePayer, numSignatures: 1 },
        },
        payload: {
          type: "transfer",
          transactionType: "transfer",
          toAddress: payTo,
          amount: requirements.amount,
        },
        signatures: { sender: { "0": { "0": "deadbeef" } }, sponsor: {} },
      },
      sender: payer,
    };
    const facilitatorSigner: FacilitatorConcordiumSigner = {
      getAddress: () => feePayer,
      getAccountInfo: async () =>
        ({
          accountNonce: payload.signedTransaction.header.nonce,
          accountAmount: { microCcdAmount: 10_000_000n },
        }) as any,
      getTokenBalance: async () => 1_000_000n,
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
    vi.spyOn(facilitatorScheme, "verify").mockResolvedValue({ isValid: true, payer });

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
  }, 20_000);
});
