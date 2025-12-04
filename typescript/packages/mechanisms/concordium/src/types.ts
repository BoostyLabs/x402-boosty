/**
 * Concordium-specific types for the x402 payment protocol.
 *
 * Unlike EVM which uses EIP-3009 TransferWithAuthorization (signed off-chain, executed on-chain by facilitator),
 * Concordium uses a simpler flow where the client broadcasts the transaction directly and provides the txHash.
 */

/**
 * The payload structure for Concordium exact payments (V2).
 *
 * In the Concordium flow:
 * 1. Client receives 402 with payment requirements
 * 2. Client creates and broadcasts transaction from their Concordium wallet
 * 3. Client sends this payload with the txHash to the server
 * 4. Facilitator verifies the transaction on-chain and confirms settlement
 */
export interface ExactConcordiumPayloadV2 extends Record<string, unknown> {
  /**
   * The transaction hash of the already-broadcasted payment transaction
   */
  txHash: string;

  /**
   * The sender's Concordium account address
   */
  sender: string;

  /**
   * Optional: Block hash where the transaction was included (for faster verification)
   */
  blockHash?: string;
}

/**
 * The payload structure for Concordium exact payments (V1 - legacy).
 */
export interface ExactConcordiumPayloadV1 extends Record<string, unknown> {
  /**
   * The transaction hash of the already-broadcasted payment transaction
   */
  txHash: string;

  /**
   * The sender's Concordium account address
   */
  sender: string;

  /**
   * Optional: Block hash where the transaction was included
   */
  blockHash?: string;
}

/**
 * Concordium network identifiers following CAIP-2 format.
 * Format: ccd:<truncated-genesis-hash>
 *
 * @example "ccd:9dd9ca4d19e9393877d2c44b70f89acb" - Mainnet
 * @example "ccd:4221332d34e1694168c2a0c0b3fd0f27" - Testnet
 */
export type ConcordiumNetwork = `ccd:${string}`;

/**
 * Known Concordium networks with their CAIP-2 identifiers
 */
export const CONCORDIUM_NETWORKS = {
  /** Concordium Mainnet */
  MAINNET: "ccd:9dd9ca4d19e9393877d2c44b70f89acb" as ConcordiumNetwork,
  /** Concordium Testnet */
  TESTNET: "ccd:4221332d34e1694168c2a0c0b3fd0f27" as ConcordiumNetwork,
} as const;

/**
 * V1 network names for backwards compatibility
 */
export const CONCORDIUM_V1_NETWORKS = [
  "concordium",
  "concordium-testnet",
] as const;

export type ConcordiumV1Network = (typeof CONCORDIUM_V1_NETWORKS)[number];

/**
 * Asset information for Concordium tokens
 */
export interface ConcordiumAssetInfo {
  /** Contract index for CIS-2 tokens, or empty string for native CCD */
  contractIndex: string;
  /** Contract subindex for CIS-2 tokens */
  contractSubindex: string;
  /** Token ID for CIS-2 tokens */
  tokenId: string;
  /** Human-readable name */
  name: string;
  /** Number of decimals */
  decimals: number;
}

/**
 * Default CCD (native token) asset info
 */
export const CCD_NATIVE_ASSET: ConcordiumAssetInfo = {
  contractIndex: "",
  contractSubindex: "",
  tokenId: "",
  name: "CCD",
  decimals: 6, // CCD has 6 decimals (microCCD)
};
