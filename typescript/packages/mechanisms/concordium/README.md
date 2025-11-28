# @x402/concordium

Concordium blockchain implementation of the x402 payment protocol using the **Exact** payment scheme with client-broadcast transactions.

## Installation
```bash
npm install @x402/concordium
```

## Overview

This package provides three main components for handling x402 payments on the Concordium blockchain:

- **Client** - For applications that need to make payments (integrates with Concordium wallets)
- **Facilitator** - For payment processors that verify on-chain transactions
- **Server** - For resource servers that accept payments and build payment requirements

## Key Difference from EVM

Unlike EVM which uses EIP-3009 TransferWithAuthorization (signed off-chain, executed by facilitator), Concordium uses a **client-broadcast** flow:

1. Client receives 402 with payment requirements
2. Client creates and broadcasts transaction directly from wallet
3. Client sends payment payload with `txHash` to server
4. Facilitator verifies transaction on-chain (no execution needed)

This means **no signatures in payload** - the transaction is already on-chain when verified.

## Package Exports

### Main Package (`@x402/concordium`)

**V2 Protocol Support** - Modern x402 protocol with CAIP-2 network identifiers

**Client:**
- `ExactConcordiumClient` - V2 client implementation
- `ExactConcordiumSchemeConfig` - Configuration interface with transaction callback

**Facilitator:**
- `ExactConcordiumFacilitator` - V2 facilitator for payment verification
- `ConcordiumNodeClient` - Interface for Concordium node operations
- `ConcordiumTransactionInfo` - Transaction details type

**Server:**
- `ExactConcordiumServer` - V2 server for building payment requirements

### Subpath Exports
```typescript
// Client
import { ExactConcordiumScheme, registerExactConcordiumScheme } from "@x402/concordium/exact/client";

// Server
import { ExactConcordiumScheme, registerExactConcordiumScheme } from "@x402/concordium/exact/server";

// Facilitator
import { ExactConcordiumScheme, registerExactConcordiumScheme } from "@x402/concordium/exact/facilitator";

// Utilities
import { createConcordiumNodeClient, createMockConcordiumNodeClient } from "@x402/concordium/utils";
```

### V1 Package (Legacy)

**Supported V1 Networks:**
```typescript
[
  "concordium",
  "concordium-testnet"
]
```

## Usage Patterns

### 1. Client Setup
```typescript
import { x402Client } from "@x402/core/client";
import { registerExactConcordiumScheme } from "@x402/concordium/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const client = new x402Client();

registerExactConcordiumScheme(client, {
  createAndBroadcastTransaction: async (payTo, amount, asset) => {
    // Integrate with your Concordium wallet (browser extension, SDK, etc.)
    const txHash = await concordiumWallet.sendCCD({
      to: payTo,
      amount: BigInt(amount),
    });
    
    return {
      txHash,
      sender: concordiumWallet.address,
    };
  },
});

// Use with fetch wrapper
const paidFetch = wrapFetchWithPayment(fetch, client);
const response = await paidFetch("https://api.example.com/premium");
```

### 2. Server Setup
```typescript
import { x402HTTPResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactConcordiumScheme } from "@x402/concordium/exact/server";

const routes = {
  "GET /api/premium": {
    scheme: "exact",
    network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb", // Mainnet
    payTo: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
    price: "1.0", // 1 CCD
    description: "Premium API access",
    mimeType: "application/json",
  },
};

const facilitator = new HTTPFacilitatorClient({
  url: "https://your-facilitator.example.com",
});

const server = new x402HTTPResourceServer(routes, facilitator);
registerExactConcordiumScheme(server, {});

await server.initialize();
```

### 3. Facilitator Setup
```typescript
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactConcordiumScheme } from "@x402/concordium/exact/facilitator";

// Implement ConcordiumNodeClient interface
const nodeClient = {
  async getTransactionStatus(txHash) {
    // Query Concordium node for transaction status
    const status = await grpcClient.getBlockItemStatus(txHash);
    return mapToTransactionInfo(status);
  },
  async waitForFinalization(txHash, timeoutMs) {
    // Poll until finalized or timeout
    // ...
  },
};

const facilitator = new x402Facilitator();

registerExactConcordiumScheme(facilitator, {
  nodeClient,
  requireFinalization: true,    // Wait for finalization (default: true)
  finalizationTimeoutMs: 60000, // 60 second timeout (default)
});
```

### 4. Direct Registration (Full Control)
```typescript
import { x402Client } from "@x402/core/client";
import { ExactConcordiumScheme } from "@x402/concordium/exact/client";

const client = new x402Client()
  .register("ccd:*", new ExactConcordiumScheme({
    createAndBroadcastTransaction: async (payTo, amount, asset) => {
      // Your wallet integration
      return { txHash, sender };
    },
  }))
  .registerV1("concordium", scheme)
  .registerV1("concordium-testnet", scheme);
```

## Supported Networks

**V2 Networks** (via CAIP-2):
- `ccd:9dd9ca4d19e9393877d2c44b70f89acb` - Concordium Mainnet
- `ccd:4221332d34e1694168c2a0c0b3fd0f27` - Concordium Testnet
- `ccd:*` - Wildcard (matches all Concordium networks)

**V1 Networks** (simple names):
- `concordium`
- `concordium-testnet`

## Asset Support

**Native CCD:**
- Asset field: `""` (empty string)
- Decimals: 6 (microCCD)

**CIS-2 Tokens (Future):**
- Asset field: `"contractIndex:subindex:tokenId"`
- Example: `"1234:0:mytoken"`

## Payment Flow
```
┌─────────┐         ┌─────────┐         ┌─────────────┐         ┌───────────┐
│  Client │         │  Server │         │ Facilitator │         │ Concordium│
└────┬────┘         └────┬────┘         └──────┬──────┘         └─────┬─────┘
     │                   │                     │                      │
     │ GET /resource     │                     │                      │
     │──────────────────>│                     │                      │
     │                   │                     │                      │
     │ 402 + PaymentReq  │                     │                      │
     │<──────────────────│                     │                      │
     │                   │                     │                      │
     │ Broadcast Transaction                   │                      │
     │───────────────────────────────────────────────────────────────>│
     │                   │                     │                      │
     │ txHash            │                     │                      │
     │<───────────────────────────────────────────────────────────────│
     │                   │                     │                      │
     │ GET /resource + X-PAYMENT (txHash)      │                      │
     │──────────────────>│                     │                      │
     │                   │                     │                      │
     │                   │ Verify(txHash)      │                      │
     │                   │────────────────────>│                      │
     │                   │                     │ GetTxStatus          │
     │                   │                     │─────────────────────>│
     │                   │                     │ TxInfo               │
     │                   │                     │<─────────────────────│
     │                   │ Valid               │                      │
     │                   │<────────────────────│                      │
     │                   │                     │                      │
     │ 200 + Content     │                     │                      │
     │<──────────────────│                     │                      │
```

## API Reference

### ConcordiumNodeClient Interface

Implement this to connect your facilitator to a Concordium node:
```typescript
interface ConcordiumNodeClient {
  getTransactionStatus(txHash: string): Promise<ConcordiumTransactionInfo | null>;
  waitForFinalization(txHash: string, timeoutMs?: number): Promise<ConcordiumTransactionInfo | null>;
}

interface ConcordiumTransactionInfo {
  txHash: string;
  blockHash: string;
  status: "pending" | "committed" | "finalized" | "failed";
  sender: string;
  recipient?: string;
  amount?: string;
  asset?: string;
  error?: string;
}
```

### ExactConcordiumSchemeConfig (Client)
```typescript
interface ExactConcordiumSchemeConfig {
  createAndBroadcastTransaction: (
    payTo: string,
    amount: string,
    asset: string,
  ) => Promise<{ txHash: string; sender: string; blockHash?: string }>;
}
```

### ConcordiumFacilitatorConfig
```typescript
interface ConcordiumFacilitatorConfig {
  nodeClient: ConcordiumNodeClient;
  requireFinalization?: boolean;  // default: true
  finalizationTimeoutMs?: number; // default: 60000
  networks?: Network[];           // default: wildcard "ccd:*"
}
```

## Development
```bash
# Build
npm run build

# Test
npm run test

# Lint & Format
npm run lint
npm run format
```

## Related Packages

- `@x402/core` - Core protocol types and client
- `@x402/fetch` - HTTP wrapper with automatic payment handling
- `@x402/evm` - EVM/Ethereum implementation
- `@x402/svm` - Solana/SVM implementation