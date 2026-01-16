/**
 * Concordium types for x402 payment protocol.
 */

/**
 * Concordium payment payload (V2).
 */
export interface ExactConcordiumPayloadV2 {
  /** Transaction hash */
  txHash: string;
  /** Sender address */
  sender: string;
  /** Asset symbol ("" for CCD, "EURR" for PLT) */
  asset?: string;
  /** Block hash */
  blockHash?: string;

  [key: string]: unknown;
}

/**
 * Concordium payment payload (V1 - legacy).
 */
export interface ExactConcordiumPayloadV1 {
  /** Transaction hash */
  txHash: string;
  /** Sender address */
  sender: string;

  [key: string]: unknown;
}

/**
 * CAIP-2 network identifier.
 * @example "ccd:9dd9ca4d19e9393877d2c44b70f89acb"
 */
export type ConcordiumNetwork = `ccd:${string}`;
