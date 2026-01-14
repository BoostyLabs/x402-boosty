/**
 * Concordium chain configuration.
 */

export interface ChainConfig {
  name: string;
  network: string;
  v1Network: string;
  grpcUrl: string;
  explorerUrl: string;
  decimals: number;
}

export const CONCORDIUM_MAINNET: ChainConfig = {
  name: "Concordium Mainnet",
  network: "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
  v1Network: "concordium",
  grpcUrl: "grpc.mainnet.concordium.com:20000",
  explorerUrl: "https://dashboard.mainnet.concordium.software",
  decimals: 6,
};

export const CONCORDIUM_TESTNET: ChainConfig = {
  name: "Concordium Testnet",
  network: "ccd:4221332d34e1694168c2a0c0b3fd0f27",
  v1Network: "concordium-testnet",
  grpcUrl: "grpc.testnet.concordium.com:20000",
  explorerUrl: "https://dashboard.testnet.concordium.software",
  decimals: 6,
};

const CHAINS: ChainConfig[] = [CONCORDIUM_MAINNET, CONCORDIUM_TESTNET];

const BY_NETWORK = new Map(CHAINS.map((c) => [c.network, c]));
const BY_V1 = new Map(CHAINS.map((c) => [c.v1Network, c]));

/**
 * V1 network names.
 */
export const CONCORDIUM_V1_NETWORKS = CHAINS.map((c) => c.v1Network);

/**
 * Get chain config by network (V1 or V2).
 */
export function getChainConfig(network: string): ChainConfig | undefined {
  return BY_V1.get(network) ?? BY_NETWORK.get(network);
}

/**
 * Get explorer URL for transaction.
 */
export function getExplorerTxUrl(network: string, txHash: string): string | undefined {
  const config = getChainConfig(network);
  return config ? `${config.explorerUrl}/transaction/${txHash}` : undefined;
}

/**
 * Get explorer URL for account.
 */
export function getExplorerAccountUrl(network: string, address: string): string | undefined {
  const config = getChainConfig(network);
  return config ? `${config.explorerUrl}/account/${address}` : undefined;
}
