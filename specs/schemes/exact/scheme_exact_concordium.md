# Scheme: `exact` on `Concordium`

## Summary

The `exact` scheme on Concordium chains uses a **client-broadcast model** where the client directly broadcasts a CCD transfer or CIS-2 token transfer to the Concordium blockchain. The facilitator verifies the transaction on-chain and waits for ConcordiumBFT finalization before granting access. This approach differs from EVM's `EIP-3009` model because Concordium does not have an equivalent authorization-based transfer mechanism.

## PaymentPayload `payload` Field

The `payload` field of the `PaymentPayload` must contain the following fields:

- `txHash`: The transaction hash of the broadcasted transfer on Concordium.
- `sender`: The account address that sent the payment.
- `blockHash` (optional): The block hash containing the transaction.

Example `payload`:

```json
{
  "txHash": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
  "sender": "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN",
  "blockHash": "b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890"
}
```

Full `PaymentPayload` object for native CCD:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "ccd:4221332d34e1694168c2a0c0b3fd0f27",
    "amount": "1000000",
    "asset": "",
    "payTo": "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
    "maxTimeoutSeconds": 60,
    "extra": {}
  },
  "payload": {
    "txHash": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
    "sender": "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN"
  }
}
```

Full `PaymentPayload` object for CIS-2 token (EUROe):

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
    "amount": "5000000",
    "asset": "9390:0:",
    "payTo": "4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW",
    "maxTimeoutSeconds": 60,
    "extra": {
      "name": "EUROe"
    }
  },
  "payload": {
    "txHash": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
    "sender": "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN",
    "blockHash": "b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890"
  }
}
```

## Asset Format

| Asset Type | Format | Example |
|------------|--------|---------|
| Native CCD | Empty string | `""` |
| CIS-2 Token | `contractIndex:contractSubindex:tokenId` | `"9390:0:"` |

## Network Identifiers

Concordium uses CAIP-2 format with the `ccd` namespace:

| Network | CAIP-2 Identifier | V1 Name (legacy) |
|---------|-------------------|------------------|
| Mainnet | `ccd:9dd9ca4d19e9393877d2c44b70f89acb` | `concordium` |
| Testnet | `ccd:4221332d34e1694168c2a0c0b3fd0f27` | `concordium-testnet` |

## Verification

Steps to verify a payment for the `exact` scheme on Concordium:

1. Verify the `scheme` matches `"exact"`
2. Verify the `network` is a supported Concordium network
3. Query the transaction status from a Concordium node via gRPC
4. Verify the transaction exists and is not in `failed` state
5. Verify the transaction `sender` matches `payload.sender`
6. Verify the transaction `recipient` matches `PaymentRequirements.payTo`
7. Verify the transaction `amount` is greater than or equal to `PaymentRequirements.amount`
8. Verify the transaction `asset` matches `PaymentRequirements.asset`
9. If `requireFinalization` is enabled, verify the transaction status is `finalized`

## Settlement

Settlement on Concordium differs from EVM because the client has already broadcast the transaction:

1. Call `verify()` to validate the payment
2. Wait for transaction finalization using ConcordiumBFT consensus
3. Return success with the transaction hash once finalized

The facilitator does **not** broadcast any transaction. Settlement is simply waiting for the already-broadcast transaction to reach finality.

```
┌─────────┐      ┌─────────┐      ┌─────────────┐      ┌────────────┐
│  Client │      │  Server │      │ Facilitator │      │ Concordium │
└────┬────┘      └────┬────┘      └──────┬──────┘      └─────┬──────┘
     │                │                   │                   │
     │  1. Request    │                   │                   │
     │────────────────>                   │                   │
     │                │                   │                   │
     │  402 + PaymentRequirements         │                   │
     │<────────────────                   │                   │
     │                │                   │                   │
     │  2. Broadcast CCD/CIS-2 transfer   │                   │
     │────────────────────────────────────────────────────────>
     │                │                   │                   │
     │  3. txHash     │                   │                   │
     │                │                   │                   │
     │  Request + PaymentPayload          │                   │
     │────────────────>                   │                   │
     │                │                   │                   │
     │                │  4. verify()      │                   │
     │                │───────────────────>                   │
     │                │                   │                   │
     │                │                   │  5. gRPC query    │
     │                │                   │───────────────────>
     │                │                   │                   │
     │                │                   │  6. tx status     │
     │                │                   │<───────────────────
     │                │                   │                   │
     │                │  7. VerifyResponse│                   │
     │                │<───────────────────                   │
     │                │                   │                   │
     │                │  8. settle()      │                   │
     │                │───────────────────>                   │
     │                │                   │                   │
     │                │                   │  9. wait finality │
     │                │                   │───────────────────>
     │                │                   │                   │
     │                │  10. SettleResponse                   │
     │                │<───────────────────                   │
     │                │                   │                   │
     │  11. Response  │                   │                   │
     │<────────────────                   │                   │
```

## Comparison with EVM

| Aspect | EVM (`EIP-3009`) | Concordium |
|--------|------------------|------------|
| Authorization | Signed `transferWithAuthorization` | Direct transaction |
| Who Broadcasts | Facilitator | Client |
| Payload Content | Signature + authorization params | txHash + sender |
| Facilitator Role | Execute transfer | Verify transfer |
| Finality | Block confirmations | ConcordiumBFT (~10s) |
| Gas/Fee Payer | Facilitator | Client |

## Transaction Status Mapping

| Concordium Status | Internal Status | Description |
|-------------------|-----------------|-------------|
| `received` | `pending` | Transaction received by node |
| `committed` | `committed` | Transaction in a block |
| `finalized` | `finalized` | Transaction finalized by ConcordiumBFT |
| `reject` | `failed` | Transaction rejected |

## Security Considerations

### Finalization Requirement

Concordium uses ConcordiumBFT consensus which provides deterministic finality. Unlike probabilistic finality on PoW chains, once a transaction is `finalized` on Concordium, it cannot be reverted. The facilitator should:

- **Always require finalization** for production use (`requireFinalization: true`)
- Configure appropriate timeout (`finalizationTimeoutMs`, default 60000ms)
- Average finalization time is ~10 seconds

### Double-Spend Prevention

Because the client broadcasts the transaction before sending the payload, there's no risk of signature replay. Each transaction hash is unique and can only be used once on-chain.

### Amount Verification

The facilitator must verify `txAmount >= requiredAmount` (not strict equality) to handle:
- Rounding differences
- Overpayment scenarios

## Appendix

### Why Client-Broadcast?

Concordium does not have an equivalent to EIP-3009 (`transferWithAuthorization`). The available options are:

1. **Client-broadcast (chosen)**: Client sends transaction, facilitator verifies
2. **Sponsored transactions**: Concordium supports sponsored transactions, but requires additional infrastructure

Client-broadcast was chosen for simplicity and alignment with Concordium's standard transaction model.

### CIS-2 Token Standard

CIS-2 is Concordium's token standard (similar to ERC-20). Key differences:

- Tokens are identified by `(contractIndex, contractSubindex, tokenId)` tuple
- Single contract can hold multiple token types
- Events are binary-encoded (not ABI-encoded like EVM)

### Supported Tokens

| Token | Network | Contract Index | Type |
|-------|---------|----------------|------|
| CCD | All | Native | Native |
| EUROe | Mainnet | 9390 | Stablecoin |
| PLT | Testnet | 7260 | Platform |

### gRPC Interface

The facilitator queries Concordium nodes via gRPC:

```typescript
interface ConcordiumNodeClient {
  getTransactionStatus(txHash: string): Promise<ConcordiumTransactionInfo | null>;
  waitForFinalization(txHash: string, timeoutMs?: number): Promise<ConcordiumTransactionInfo | null>;
}
```

### Future Considerations

- **Sponsored Transactions**: Could enable facilitator-broadcast model similar to EVM
- **CIS-5**: Smart contract wallets with meta-transactions
- **Identity Integration**: Concordium's built-in identity layer for compliance use cases