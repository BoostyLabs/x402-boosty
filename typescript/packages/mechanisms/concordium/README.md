# @x402/concordium

Concordium blockchain implementation of the x402 payment protocol using the **Exact** payment scheme with **sponsored transactions (V1)**.

## Installation

```bash
npm install @x402/concordium
```

## Overview

This package provides three components for handling x402 payments on Concordium:

- **Client** — Builds and sender-signs a V1 sponsored transaction, returning the partially-signed payload
- **Facilitator** — Verifies the payload against 9 security rules, adds sponsor signature, submits to the network, and waits for finalization
- **Server** — Builds `PaymentRequirements` with price parsing, asset registration, and sponsor address injection

## Sponsored Transaction Flow

Unlike EVM (where the facilitator executes an off-chain signature via `TransferWithAuthorization`), Concordium uses **V1 sponsored transactions** where the facilitator pays gas on behalf of the sender:

1. Client builds a transfer transaction naming the facilitator as sponsor
2. Client signs as sender (sponsor signature slot left empty)
3. Client sends the partially-signed transaction to the server
4. Facilitator verifies the transaction structure and parameters
5. Facilitator adds its sponsor signature, submits to the network, and waits for ConcordiumBFT finalization (~10s deterministic finality)
6. Server grants access to the resource

The client never broadcasts — the facilitator handles submission after sponsoring.

## Supported Assets

| Type | Symbol | Description | Decimals |
|------|--------|-------------|----------|
| Native | CCD | Native Concordium token | 6 |
| PLT | EURR, USDR, etc. | PLT standard tokens | 6 |

## Usage

### 1. Client Setup

The client builds and sender-signs a V1 sponsored transaction. It needs a Concordium account signer (from a wallet export or key pair).

```typescript
import { ExactConcordiumScheme } from "@x402/concordium/exact/client";
import { parseWallet, buildAccountSigner, AccountAddress } from "@concordium/web-sdk";
import { readFileSync } from "fs";

// Load wallet
const walletExport = parseWallet(readFileSync("./wallet.export", "utf8"));

const signer = {
  accountAddress: AccountAddress.fromBase58(walletExport.value.address),
  signer: buildAccountSigner(walletExport),
};

const scheme = new ExactConcordiumScheme(signer);

// createPaymentPayload is called automatically by x402 client internals:
// 1. Fetches sender nonce from node
// 2. Builds CCD or PLT transfer
// 3. Sets facilitator as sponsor (from requirements.extra.sponsorAddress)
// 4. Signs as sender via Transaction.sign()
// 5. Returns { signedTransaction, sender } payload
```

With custom gRPC endpoint:

```typescript
const scheme = new ExactConcordiumScheme(signer, {
  grpcUrl: "localhost:20000",
  useTls: false,
});
```

### 2. Server Setup

The server registers assets and builds `PaymentRequirements`. The `sponsorAddress` parameter is injected into `extra.sponsorAddress` so clients know which address to name as sponsor.

```typescript
import { ExactConcordiumScheme } from "@x402/concordium/exact/server";

// Pass the facilitator's sponsor address so it's included in PaymentRequirements
const scheme = new ExactConcordiumScheme("4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW");

// Register PLT tokens (native CCD works by default)
scheme
  .registerAsset("ccd:*", "EURR", 6)
  .registerAsset("ccd:*", "USDR", 6);

// Route configuration examples:

// Native CCD payment
const ccdRoute = {
  scheme: "exact",
  network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
  payTo: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
  price: "10",  // 10 CCD → converted to "10000000" microCCD
  description: "Premium content",
  mimeType: "application/json",
};

// PLT token payment
const pltRoute = {
  scheme: "exact",
  network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
  payTo: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
  price: { amount: "1", asset: "EURR" },  // 1 EURR
  description: "Premium content - 1 EURR",
  mimeType: "application/json",
};
```

### 3. Facilitator Setup

The facilitator verifies partially-signed transactions, adds its sponsor signature, submits to the network, and waits for finalization.

```typescript
import { ExactConcordiumScheme } from "@x402/concordium/exact/facilitator";
import { toConcordiumFacilitatorSigner } from "@x402/concordium/signer";
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { parseWallet, buildAccountSigner, AccountAddress } from "@concordium/web-sdk";
import { readFileSync } from "fs";

// Load sponsor wallet
const walletExport = parseWallet(readFileSync("./sponsor-wallet.export", "utf8"));
const sponsorAccount = AccountAddress.fromBase58(walletExport.value.address);
const sponsorSigner = buildAccountSigner(walletExport);

// Connect to node
const grpcClient = new ConcordiumGRPCNodeClient(
  "grpc.mainnet.concordium.software",
  20000,
  credentials.createSsl(),
);

// Create facilitator signer
const signer = toConcordiumFacilitatorSigner(sponsorAccount, sponsorSigner, grpcClient);

// Create scheme
const scheme = new ExactConcordiumScheme({
  signer,
  requireFinalization: true,      // default: true
  finalizationTimeoutMs: 60_000,  // default: 60000
  maxExpiryOffsetSeconds: 600,    // default: 600
  supportedAssets: [
    { symbol: "CCD", decimals: 6 },
    { symbol: "EURR", decimals: 6 },
  ],
});

// verify() and settle() are called by x402 facilitator internals
```

## Payment Flow

```
┌─────────┐       ┌──────────┐      ┌──────────────┐      ┌────────────┐
│  Client  │      │  Server  │      │ Facilitator  │      │ Concordium │
└────┬─────┘      └────┬─────┘      └──────┬───────┘      └─────┬──────┘
     │                  │                    │                     │
     │  1. GET /resource                     │                     │
     │─────────────────>│                    │                     │
     │                  │                    │                     │
     │  2. 402 + PaymentRequirements         │                     │
     │     (includes extra.sponsorAddress)   │                     │
     │<─────────────────│                    │                     │
     │                  │                    │                     │
     │  3. Fetch nonce from node             │                     │
     │────────────────────────────────────────────────────────────>│
     │                  │                    │                     │
     │  4. Build V1 sponsored tx             │                     │
     │     (sponsor = facilitator address)   │                     │
     │     Sign as sender                    │                     │
     │     Sponsor signature slot = empty    │                     │
     │                  │                    │                     │
     │  5. GET /resource + X-PAYMENT header  │                     │
     │     payload: { signedTransaction,     │                     │
     │               sender }                │                     │
     │─────────────────>│                    │                     │
     │                  │                    │                     │
     │                  │  6. verify(payload, requirements)        │
     │                  │───────────────────>│                     │
     │                  │                    │                     │
     │                  │    Enforces 9 rules:                     │
     │                  │    - Version == 1                        │
     │                  │    - Sender identity                     │
     │                  │    - Sponsor identity                    │
     │                  │    - Transfer destination                │
     │                  │    - Amount >= required                  │
     │                  │    - Asset type match                    │
     │                  │    - Expiry valid                        │
     │                  │    - Sender signature present            │
     │                  │    - Payload safety                      │
     │                  │                    │                     │
     │                  │  7. VerifyResponse  │                     │
     │                  │<───────────────────│                     │
     │                  │                    │                     │
     │                  │  8. settle(payload, requirements)        │
     │                  │───────────────────>│                     │
     │                  │                    │                     │
     │                  │    Re-verify       │                     │
     │                  │    Add sponsor sig │                     │
     │                  │    Finalize tx     │                     │
     │                  │                    │  9. sendTransaction  │
     │                  │                    │────────────────────>│
     │                  │                    │                     │
     │                  │                    │  10. waitForFinalization
     │                  │                    │────────────────────>│
     │                  │                    │                     │
     │                  │                    │  11. Defense-in-depth│
     │                  │                    │      on-chain checks│
     │                  │                    │                     │
     │                  │  12. SettleResponse │                     │
     │                  │<───────────────────│                     │
     │                  │                    │                     │
     │  13. 200 OK + Resource                │                     │
     │<─────────────────│                    │                     │
```

## Facilitator Verification Rules

The facilitator enforces all 9 rules before sponsoring:

1. **Transaction version** — Must be V1 sponsored format, deserializable via `signableFromJSON()`
2. **Sender identity** — `header.sender` matches `payload.sender`, valid base58
3. **Sponsor identity** — `header.sponsor.account` matches facilitator's own address
4. **Transfer destination** — Recipient matches `PaymentRequirements.payTo`
5. **Amount** — Transfer amount ≥ `PaymentRequirements.amount`
6. **Asset type** — SimpleTransfer for CCD, TokenUpdate with matching tokenId for PLT
7. **Expiry** — In the future and ≤ 10 minutes from now
8. **Sender signature** — At least one credential signature present
9. **Payload safety** — Exactly one operation, sponsor not sender/recipient

## Payload Format

The `PaymentPayload.payload` field for the exact scheme (x402Version: 2):

```json
{
  "signedTransaction": {
    "version": 1,
    "header": {
      "sender": "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN",
      "nonce": 42,
      "expiry": 1700000300,
      "numSignatures": 1,
      "sponsor": {
        "address": "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
        "numSignatures": 1
      }
    },
    "payload": { "..." : "CCD transfer or PLT tokenUpdate payload" },
    "signatures": {
      "sender": { "0": { "0": "a1b2c3..." } },
      "sponsor": {}
    }
  },
  "sender": "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN"
}
```

The `signatures.sender` is populated by the client. The `signatures.sponsor` is empty `{}` — the facilitator fills it during settlement.

## Supported Networks

| Network | CAIP-2 Identifier | gRPC Endpoint |
|---------|-------------------|---------------|
| Mainnet | `ccd:9dd9ca4d19e9393877d2c44b70f89acb` | `grpc.mainnet.concordium.software:20000` |
| Testnet | `ccd:4221332d34e1694168c2a0c0b3fd0f27` | `grpc.testnet.concordium.com:20000` |

Wildcard `ccd:*` can be used for asset registration that applies to all networks.

## Chain Configuration

```typescript
import {
  getChainConfig,
  getExplorerTxUrl,
  CONCORDIUM_MAINNET,
  CONCORDIUM_TESTNET,
} from "@x402/concordium/config";

const config = getChainConfig("ccd:9dd9ca4d19e9393877d2c44b70f89acb");
// {
//   name: "Concordium Mainnet",
//   network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
//   v1Network: "concordium",
//   grpcUrl: "grpc.mainnet.concordium.software:20000",
//   explorerUrl: "https://ccdexplorer.io/mainnet",
//   decimals: 6,
// }

// V1 network names also work
const testnet = getChainConfig("concordium-testnet");

// Explorer links
const txUrl = getExplorerTxUrl("concordium", "a1b2c3...");
// "https://ccdexplorer.io/mainnet/transaction/a1b2c3..."
```

## Amount Format

All amounts in `PaymentRequirements` and payloads are in the smallest unit (atomic):

| Asset Type | Unit | Decimals | Example: 10 CCD / 5 EURR |
|------------|------|----------|---------------------------|
| Native CCD | microCCD | 6 | `"10000000"` |
| PLT Token | Smallest subunit | 6 | `"5000000"` |

The server scheme handles conversion from human-readable prices:

```typescript
// Server scheme converts automatically:
// price: "10"                          → amount: "10000000" (10 CCD)
// price: "10.5"                        → amount: "10500000" (10.5 CCD)
// price: { amount: "5", asset: "EURR" } → amount: "5" (5 EURR whole units)
```

## API Reference

### ClientConcordiumSigner

```typescript
interface ClientConcordiumSigner {
  accountAddress: AccountAddress.Type;
  signer: AccountSigner;
}
```

### FacilitatorConcordiumSigner

```typescript
interface FacilitatorConcordiumSigner {
  getAddress(): string;
  addSponsorSignature(tx: SignableV1Transaction): Promise<Transaction.JSON>;
  submitTransaction(signedTxJSON: Transaction.JSON): Promise<string>;
  waitForFinalization(txHash: string, timeoutMs?: number): Promise<TransactionInfo>;
}
```

### ExactConcordiumSchemeConfig (Facilitator)

```typescript
interface ExactConcordiumSchemeConfig {
  signer: FacilitatorConcordiumSigner;
  requireFinalization?: boolean;        // default: true
  finalizationTimeoutMs?: number;       // default: 60000
  maxExpiryOffsetSeconds?: number;      // default: 600
  supportedAssets?: Array<{ symbol: string; decimals: number }>;
}
```

### Types

```typescript
// Transaction status from on-chain queries
interface TransactionInfo {
  txHash: string;
  status: "pending" | "committed" | "finalized" | "failed";
  sender: string;
  recipient?: string;
  amount?: string;
  asset?: string;  // "" for CCD, token symbol for PLT
}

// V2 payment payload (sent in X-PAYMENT header)
interface ExactConcordiumPayloadV2 {
  signedTransaction: SignableV1Transaction;
  sender: string;
}
```

## Error Codes

### Verification errors (from `verify()`)

| Code | Rule | Description |
|------|------|-------------|
| `missing_payload` | — | Payload is null or not an object |
| `invalid_transaction_format` | 1 | Cannot deserialize transaction |
| `invalid_transaction_version` | 1 | Version is not 1 |
| `missing_sender` / `invalid_sender_address` | 2 | Sender missing or invalid base58 |
| `sender_header_mismatch` | 2 | `header.sender` ≠ `payload.sender` |
| `missing_sponsor_in_header` / `sponsor_mismatch` | 3 | Sponsor missing or doesn't match facilitator |
| `transaction_expired` / `expiry_too_far_in_future` | 7 | Expiry out of valid window |
| `sponsor_as_sender` / `sponsor_as_recipient` | 9 | Sponsor appears in transfer |
| `unexpected_transaction_type` | 9 | Not a transfer or tokenUpdate |
| `asset_type_mismatch` / `token_id_mismatch` | 6 | Wrong tx type for expected asset |
| `missing_recipient` / `recipient_mismatch` | 4 | Recipient doesn't match payTo |
| `insufficient_amount` | 5 | Amount below required |
| `missing_sender_signature` | 8 | No credential signature present |

### Settlement errors (from `settle()`)

| Code | Description |
|------|-------------|
| `sponsor_signing_failed` | Failed to add sponsor signature |
| `submission_failed` | gRPC send failed |
| `finalization_failed` / `finalization_timeout` | On-chain finalization issue |
| `on_chain_sender_mismatch` | Defense-in-depth: sender differs |
| `on_chain_recipient_mismatch` | Defense-in-depth: recipient differs |
| `on_chain_insufficient_amount` | Defense-in-depth: amount too low |

## File Structure

```
@x402/concordium/
├── index.ts                    # Package entry point
├── types.ts                    # SignableV1Transaction, ExactConcordiumPayloadV2
├── signer.ts                   # ClientConcordiumSigner, FacilitatorConcordiumSigner
├── client.ts                   # ConcordiumClient (gRPC wrapper)
├── config/
│   ├── chains.ts               # Network registry, explorer URLs
│   └── index.ts
└── exact/
    ├── client/
    │   ├── scheme.ts           # Builds + sender-signs V1 sponsored tx
    │   └── index.ts
    ├── server/
    │   ├── scheme.ts           # Price parsing, asset registration
    │   └── index.ts
    └── facilitator/
        ├── scheme.ts           # 9-rule verify + sponsor-sign-submit settle
        └── index.ts
```

## Related Packages

- `@x402/core` — Core protocol types, client, facilitator, and server
- `@x402/fetch` — HTTP wrapper with automatic payment handling
- `@concordium/web-sdk` — Concordium SDK (peer dependency)