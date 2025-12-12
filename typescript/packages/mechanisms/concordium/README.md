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
- `ExactConcordiumScheme` - V2 client implementation
- `registerExactConcordiumScheme` - Registration helper

**Facilitator:**
- `ExactConcordiumScheme` - V2 facilitator for payment verification
- `ConcordiumNodeClient` - Interface for Concordium node operations
- `ConcordiumTransactionInfo` - Transaction details type

**Server:**
- `ExactConcordiumScheme` - V2 server for building payment requirements
- `ConcordiumAssetInfo` - Asset configuration type
- `CCD_NATIVE` - Native CCD asset constant

### Subpath Exports
```typescript
// Client
import { ExactConcordiumScheme, registerExactConcordiumScheme } from "@x402/concordium/exact/client";

// Server
import { ExactConcordiumScheme, registerExactConcordiumScheme } from "@x402/concordium/exact/server";

// Facilitator
import { ExactConcordiumScheme, registerExactConcordiumScheme } from "@x402/concordium/exact/facilitator";

// Config
import { getChainConfig, CONCORDIUM_CHAINS } from "@x402/concordium/config";

// Utilities
import { createConcordiumNodeClient, createMockConcordiumNodeClient } from "@x402/concordium/utils";
```

### V1 Package (Legacy)

**Supported V1 Networks:**
```typescript
["concordium", "concordium-testnet"]
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
import { ExactConcordiumScheme } from "@x402/concordium/exact/server";

// Create scheme and register assets
const concordiumScheme = new ExactConcordiumScheme();

// Register CIS-2 tokens (optional - native CCD works by default)
concordiumScheme
  .registerAsset("ccd:9dd9ca4d19e9393877d2c44b70f89acb", "EUROe", {
    contractIndex: "9390",
    contractSubindex: "0",
    tokenId: "",
    name: "EUROe Stablecoin",
    decimals: 6,
  })
  .registerAsset("ccd:4221332d34e1694168c2a0c0b3fd0f27", "TestUSD", {
    contractIndex: "7260",
    contractSubindex: "0",
    tokenId: "111111",
    name: "PLT",
    decimals: 6,
  });

// Define routes
const routes = {
  // Native CCD payment (default when no extra.asset)
  "GET /api/basic": {
    accepts: {
      scheme: "exact",
      network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
      payTo: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
      price: "0.5", // 0.5 CCD
    },
    description: "Basic endpoint - 0.5 CCD",
    mimeType: "application/json",
  },

  // Explicit CCD
  "GET /api/explicit-ccd": {
    accepts: {
      scheme: "exact",
      network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
      payTo: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
      price: "1.0",
      extra: { asset: "CCD" },
    },
    description: "Explicit CCD payment",
    mimeType: "application/json",
  },

  // Stablecoin payment (registered asset)
  "GET /api/premium": {
    accepts: {
      scheme: "exact",
      network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
      payTo: "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
      price: "5.00",
      extra: { asset: "EUROe" },
    },
    description: "Premium endpoint - 5 EUROe",
    mimeType: "application/json",
  },

  // Testnet endpoint
  "GET /api/test": {
    accepts: {
      scheme: "exact",
      network: "concordium-testnet", // V1 network name also works
      payTo: "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN",
      price: "10",
      extra: { asset: "PLT" },
    },
    description: "Test endpoint",
    mimeType: "application/json",
  },
};

// Create server
const facilitator = new HTTPFacilitatorClient({
  url: "https://your-facilitator.example.com",
});

const server = new x402HTTPResourceServer(routes, facilitator);
server.register("ccd:*", concordiumScheme);

await server.initialize();
```

### 3. Facilitator Setup
```typescript
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactConcordiumScheme } from "@x402/concordium/exact/facilitator";
import { createConcordiumNodeClient } from "@x402/concordium/utils";

// Create node client from gRPC client
const nodeClient = createConcordiumNodeClient(grpcClient);

// Create facilitator
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

const scheme = new ExactConcordiumScheme({
  createAndBroadcastTransaction: async (payTo, amount, asset) => {
    return { txHash, sender };
  },
});

const client = new x402Client()
  .register("ccd:*", scheme)
  .registerV1("concordium", scheme)
  .registerV1("concordium-testnet", scheme);
```

## Supported Networks

**V2 Networks** (via CAIP-2):

| Network | Identifier |
|---------|------------|
| Mainnet | `ccd:9dd9ca4d19e9393877d2c44b70f89acb` |
| Testnet | `ccd:4221332d34e1694168c2a0c0b3fd0f27` |
| Wildcard | `ccd:*` |

**V1 Networks** (simple names):
- `concordium`
- `concordium-testnet`

## Asset Support

### Native CCD

Default when no `extra.asset` specified:
```typescript
{
  price: "1.0",  // 1 CCD
  // No extra.asset = native CCD
}

// Or explicit:
{
  price: "1.0",
  extra: { asset: "CCD" },
}
```

- Asset string: `""` (empty)
- Decimals: 6 (microCCD)

### CIS-2 Tokens

Register tokens, then reference by symbol:
```typescript
// 1. Register the asset
scheme.registerAsset("ccd:9dd9ca4d19e9393877d2c44b70f89acb", "EUROe", {
  contractIndex: "9390",
  contractSubindex: "0",
  tokenId: "",
  name: "EUROe Stablecoin",
  decimals: 6,
});

// 2. Use in route config
{
  price: "5.00",
  extra: { asset: "EUROe" },
}
```

- Asset string: `"contractIndex:subindex:tokenId"` (e.g., `"9390:0:"`)

### Asset Resolution Rules

| Configuration | Result |
|---------------|--------|
| No `extra.asset` | Native CCD |
| `extra.asset: "CCD"` | Native CCD |
| `extra.asset: "EUROe"` | Lookup registered asset |
| `extra.asset: "UNKNOWN"` | **Error** - not registered |
| `price: "$1.00"` | **Error** - USD not supported |

**Note:** USD prices (`$`) are not supported. Use explicit asset symbols.

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
     │ Broadcast Tx      │                     │                      │
     │────────────────────────────────────────────────────────────────>│
     │                   │                     │                      │
     │ txHash            │                     │                      │
     │<────────────────────────────────────────────────────────────────│
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

### ConcordiumAssetInfo
```typescript
interface ConcordiumAssetInfo {
  contractIndex: string;    // Empty string for native CCD
  contractSubindex: string;
  tokenId: string;
  name: string;
  decimals: number;
}
```

### ExactConcordiumScheme (Server)
```typescript
class ExactConcordiumScheme {
  // Register a CIS-2 token
  registerAsset(
    network: Network,
    symbol: string,
    asset: ConcordiumAssetInfo,
  ): this;

  // Get registered asset
  getAsset(network: Network, symbol: string): ConcordiumAssetInfo | undefined;

  // Parse price with extra.asset support
  parsePriceWithExtra(
    price: Price,
    network: Network,
    extra?: Record<string, unknown>,
  ): AssetAmount;
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

### ConcordiumNodeClient
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

### ConcordiumFacilitatorConfig
```typescript
interface ConcordiumFacilitatorConfig {
  nodeClient: ConcordiumNodeClient;
  requireFinalization?: boolean;  // default: true
  finalizationTimeoutMs?: number; // default: 60000
  networks?: Network[];           // default: wildcard "ccd:*"
}
```

## Chain Configuration

Access chain metadata:
```typescript
import { getChainConfig, CONCORDIUM_MAINNET, CONCORDIUM_TESTNET } from "@x402/concordium/config";

const config = getChainConfig("concordium-testnet");
// {
//   name: "Concordium Testnet",
//   network: "ccd:4221332d34e1694168c2a0c0b3fd0f27",
//   grpcUrl: "grpc.testnet.concordium.com:20000",
//   explorerUrl: "https://dashboard.testnet.concordium.software",
//   nativeToken: { symbol: "CCD", decimals: 6 },
//   ...
// }
```

## Error Handling

The server scheme throws clear errors:
```typescript
// Unknown asset
ConcordiumAssetError: Unknown asset "UNKNOWN" on ccd:9dd9ca4d...
  Registered: CCD, EUROe. Use registerAsset() to add.

// USD price not supported  
Error: USD prices not supported. Use explicit asset in extra.asset. Got: $1.00

// Invalid price
ConcordiumAssetError: Invalid price: abc

// Invalid extra.asset type
Error: extra.asset must be a string symbol. Got: object
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

## File Structure
```
@x402/concordium/
├── index.ts                 # Main exports
├── types.ts                 # Core types
├── config/
│   ├── chains.ts           # Network configurations
│   └── tokens.ts           # Token registry
├── exact/
│   ├── client/
│   │   ├── scheme.ts       # Client implementation
│   │   └── register.ts     # Registration helper
│   ├── server/
│   │   ├── scheme.ts       # Server implementation (asset registration)
│   │   └── register.ts     # Registration helper
│   ├── facilitator/
│   │   ├── scheme.ts       # Facilitator implementation
│   │   └── register.ts     # Registration helper
│   └── v1/                 # V1 legacy support
└── utils/
    └── node-client.ts      # Node client utilities
```

## Related Packages

- `@x402/core` - Core protocol types and client
- `@x402/fetch` - HTTP wrapper with automatic payment handling
- `@x402/evm` - EVM/Ethereum implementation
- `@x402/svm` - Solana/SVM implementation