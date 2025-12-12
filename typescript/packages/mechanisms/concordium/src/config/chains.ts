import { ConcordiumNetwork } from "../types";

/**
 * Concordium chain configuration
 */
export interface ConcordiumChainConfig {
  /** Human-readable chain name */
  name: string;

  /** Network identifier: "mainnet" | "testnet" */
  networkId: "mainnet" | "testnet";

  /** CAIP-2 network identifier (V2 format) */
  network: ConcordiumNetwork;

  /** V1 network name for backwards compatibility */
  v1Network: string;

  /** gRPC endpoint URL with port */
  grpcUrl: string;

  /** Alternative gRPC endpoints for failover */
  grpcUrlFallbacks?: string[];

  /** Block explorer URL */
  explorerUrl: string;

  /** Native token configuration */
  nativeToken: {
    symbol: string;
    decimals: number;
  };

  /** Average block/finalization time in seconds */
  avgFinalitySeconds: number;
}

/**
 * Concordium Mainnet configuration
 */
export const CONCORDIUM_MAINNET: ConcordiumChainConfig = {
  name: "Concordium Mainnet",
  networkId: "mainnet",
  network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
  v1Network: "concordium",
  grpcUrl: "grpc.mainnet.concordium.com:20000",
  grpcUrlFallbacks: [
    "grpc.mainnet.concordium.software:20000",
  ],
  explorerUrl: "https://dashboard.mainnet.concordium.software",
  nativeToken: {
    symbol: "CCD",
    decimals: 6,
  },
  avgFinalitySeconds: 10,
};

/**
 * Concordium Testnet configuration
 */
export const CONCORDIUM_TESTNET: ConcordiumChainConfig = {
  name: "Concordium Testnet",
  networkId: "testnet",
  network: "ccd:4221332d34e1694168c2a0c0b3fd0f27",
  v1Network: "concordium-testnet",
  grpcUrl: "grpc.testnet.concordium.com:20000",
  grpcUrlFallbacks: [
    "grpc.testnet.concordium.software:20000",
  ],
  explorerUrl: "https://dashboard.testnet.concordium.software",
  nativeToken: {
    symbol: "CCD",
    decimals: 6,
  },
  avgFinalitySeconds: 10,
};

/**
 * All supported Concordium chains indexed by V1 network name
 */
export const CONCORDIUM_CHAINS: Record<string, ConcordiumChainConfig> = {
  "concordium": CONCORDIUM_MAINNET,
  "concordium-testnet": CONCORDIUM_TESTNET,
};

/**
 * All supported chains indexed by CAIP-2 network identifier
 */
export const CONCORDIUM_CHAINS_BY_CAIP2: Record<string, ConcordiumChainConfig> = {
  [CONCORDIUM_MAINNET.network]: CONCORDIUM_MAINNET,
  [CONCORDIUM_TESTNET.network]: CONCORDIUM_TESTNET,
};

/**
 * Get chain configuration by network identifier.
 * Accepts both V1 names ("concordium-testnet") and V2 CAIP-2 ("ccd:xxx")
 *
 * @param network - Network identifier (V1 or V2 format)
 * @returns Chain configuration or undefined if not found
 */
export function getChainConfig(network: string): ConcordiumChainConfig | undefined {
  // Check V1 names first
  if (CONCORDIUM_CHAINS[network]) {
    return CONCORDIUM_CHAINS[network];
  }

  // Check V2 CAIP-2 format
  if (CONCORDIUM_CHAINS_BY_CAIP2[network]) {
    return CONCORDIUM_CHAINS_BY_CAIP2[network];
  }

  // Check if it's a wildcard match for any ccd: network
  if (network.startsWith("ccd:")) {
    // Return testnet as default for unknown ccd: networks (for development)
    // In production, you might want to throw or return undefined
    return undefined;
  }

  return undefined;
}

/**
 * Get chain configuration or throw if not found
 */
export function getChainConfigOrThrow(network: string): ConcordiumChainConfig {
  const config = getChainConfig(network);
  if (!config) {
    throw new Error(`Unknown Concordium network: ${network}`);
  }
  return config;
}

/**
 * Convert V1 network name to V2 CAIP-2 format
 */
export function v1ToV2Network(v1Network: string): ConcordiumNetwork | undefined {
  const config = CONCORDIUM_CHAINS[v1Network];
  return config?.network;
}

/**
 * Convert V2 CAIP-2 format to V1 network name
 */
export function v2ToV1Network(v2Network: string): string | undefined {
  const config = CONCORDIUM_CHAINS_BY_CAIP2[v2Network];
  return config?.v1Network;
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerTxUrl(network: string, txHash: string): string | undefined {
  const config = getChainConfig(network);
  if (!config) return undefined;
  return `${config.explorerUrl}/transaction/${txHash}`;
}

/**
 * Get explorer URL for an account
 */
export function getExplorerAccountUrl(network: string, address: string): string | undefined {
  const config = getChainConfig(network);
  if (!config) return undefined;
  return `${config.explorerUrl}/account/${address}`;
}
