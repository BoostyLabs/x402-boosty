import { ConcordiumNetwork } from "../types";

/**
 * CIS-2 Token information
 */
export interface CIS2TokenConfig {
  /** Token symbol (e.g., "EUROe", "USDC") */
  symbol: string;

  /** Human-readable name */
  name: string;

  /** Smart contract index */
  contractIndex: number;

  /** Smart contract subindex (usually 0) */
  contractSubindex: number;

  /** Token ID within the contract (empty string for single-token contracts) */
  tokenId: string;

  /** Number of decimals */
  decimals: number;

  /** Token type */
  type: "stablecoin" | "platform" | "other";

  /** Optional issuer information */
  issuer?: string;
}

/**
 * Token registry per network
 */
export interface NetworkTokenRegistry {
  /** CAIP-2 network identifier */
  network: ConcordiumNetwork;

  /** Native token (CCD) */
  nativeToken: {
    symbol: string;
    decimals: number;
  };

  /** Registered CIS-2 tokens */
  tokens: CIS2TokenConfig[];
}

/**
 * Mainnet token registry
 */
export const MAINNET_TOKENS: NetworkTokenRegistry = {
  network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
  nativeToken: {
    symbol: "CCD",
    decimals: 6,
  },
  tokens: [
    {
      symbol: "EUROe",
      name: "EUROe Stablecoin",
      contractIndex: 9390,
      contractSubindex: 0,
      tokenId: "",
      decimals: 6,
      type: "stablecoin",
      issuer: "Membrane Finance",
    },
  ],
};

/**
 * Testnet token registry
 */
export const TESTNET_TOKENS: NetworkTokenRegistry = {
  network: "ccd:4221332d34e1694168c2a0c0b3fd0f27",
  nativeToken: {
    symbol: "CCD",
    decimals: 6,
  },
  tokens: [
    {
      symbol: "PLT",
      name: "Platform token",
      contractIndex: 7260,
      contractSubindex: 0,
      tokenId: "",
      decimals: 6,
      type: "platform",
    },
  ],
};

/**
 * All token registries indexed by CAIP-2 network
 */
export const TOKEN_REGISTRIES: Record<string, NetworkTokenRegistry> = {
  [MAINNET_TOKENS.network]: MAINNET_TOKENS,
  [TESTNET_TOKENS.network]: TESTNET_TOKENS,
};

/**
 * V1 network name to token registry mapping
 */
export const TOKEN_REGISTRIES_V1: Record<string, NetworkTokenRegistry> = {
  concordium: MAINNET_TOKENS,
  "concordium-testnet": TESTNET_TOKENS,
};

/**
 * Get token registry for a network
 *
 * @param network
 */
export function getTokenRegistry(network: string): NetworkTokenRegistry | undefined {
  return TOKEN_REGISTRIES[network] || TOKEN_REGISTRIES_V1[network];
}

/**
 * Get a specific token by symbol on a network
 *
 * @param network
 * @param symbol
 */
export function getTokenBySymbol(network: string, symbol: string): CIS2TokenConfig | undefined {
  const registry = getTokenRegistry(network);
  if (!registry) return undefined;

  const upperSymbol = symbol.toUpperCase();
  return registry.tokens.find(t => t.symbol.toUpperCase() === upperSymbol);
}

/**
 * Get a token by contract index
 *
 * @param network
 * @param contractIndex
 * @param contractSubindex
 */
export function getTokenByContract(
  network: string,
  contractIndex: number,
  contractSubindex: number = 0,
): CIS2TokenConfig | undefined {
  const registry = getTokenRegistry(network);
  if (!registry) return undefined;

  return registry.tokens.find(
    t => t.contractIndex === contractIndex && t.contractSubindex === contractSubindex,
  );
}

/**
 * Get all stablecoins on a network
 *
 * @param network
 */
export function getStablecoins(network: string): CIS2TokenConfig[] {
  const registry = getTokenRegistry(network);
  if (!registry) return [];

  return registry.tokens.filter(t => t.type === "stablecoin");
}

/**
 * Format asset string for x402 protocol
 * Native CCD: "" (empty string)
 * CIS-2 tokens: "contractIndex:contractSubindex:tokenId"
 *
 * @param token
 */
export function formatAssetString(token: CIS2TokenConfig): string {
  return `${token.contractIndex}:${token.contractSubindex}:${token.tokenId}`;
}

/**
 * Parse asset string from x402 protocol
 *
 * @param asset
 */
export function parseAssetString(asset: string): {
  isNative: boolean;
  contractIndex?: number;
  contractSubindex?: number;
  tokenId?: string;
} {
  if (!asset || asset === "") {
    return { isNative: true };
  }

  const parts = asset.split(":");
  if (parts.length < 2) {
    return { isNative: true };
  }

  return {
    isNative: false,
    contractIndex: parseInt(parts[0], 10),
    contractSubindex: parseInt(parts[1], 10),
    tokenId: parts[2] || "",
  };
}

/**
 * Check if asset string represents native CCD
 *
 * @param asset
 */
export function isNativeCCD(asset: string): boolean {
  return !asset || asset === "";
}
