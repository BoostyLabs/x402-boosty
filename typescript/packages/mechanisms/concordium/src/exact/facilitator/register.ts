import { x402Facilitator } from "@x402/core/facilitator";
import { Network } from "@x402/core/types";
import { ExactConcordiumScheme, ConcordiumNodeClient } from "./scheme";
import { ExactConcordiumSchemeV1 } from "../v1";
import { CONCORDIUM_V1_NETWORKS } from "../../types";

/**
 * Configuration options for registering Concordium schemes to an x402Facilitator
 */
export interface ConcordiumFacilitatorConfig {
  /**
   * The Concordium node client for verifying and settling transactions
   */
  nodeClient: ConcordiumNodeClient;

  /**
   * Whether to wait for transaction finalization before settling.
   * If false, accepts committed (but not finalized) transactions.
   *
   * @default true
   */
  requireFinalization?: boolean;

  /**
   * Timeout in milliseconds for waiting for finalization
   *
   * @default 60000 (60 seconds)
   */
  finalizationTimeoutMs?: number;

  /**
   * Optional specific networks to register
   * If not provided, registers wildcard support (ccd:*)
   */
  networks?: Network[];
}

/**
 * Registers Concordium exact payment schemes to an x402Facilitator instance.
 *
 * This function registers:
 * - V2: ccd:* wildcard scheme with ExactConcordiumScheme (or specific networks if provided)
 * - V1: All supported Concordium V1 networks
 *
 * @param facilitator - The x402Facilitator instance to register schemes to
 * @param config - Configuration for Concordium facilitator registration
 * @returns The facilitator instance for chaining
 *
 * @example
 * ```typescript
 * import { registerExactConcordiumScheme } from "@x402/concordium/exact/facilitator";
 * import { x402Facilitator } from "@x402/core/facilitator";
 * import { ConcordiumGRPCClient } from "@concordium/node-sdk";
 *
 * const nodeClient = createConcordiumNodeClient(grpcClient);
 * const facilitator = new x402Facilitator();
 * registerExactConcordiumScheme(facilitator, { nodeClient });
 * ```
 */
export function registerExactConcordiumScheme(
  facilitator: x402Facilitator,
  config: ConcordiumFacilitatorConfig,
): x402Facilitator {
  const scheme = new ExactConcordiumScheme({
    nodeClient: config.nodeClient,
    requireFinalization: config.requireFinalization,
    finalizationTimeoutMs: config.finalizationTimeoutMs,
  });

  // Register V2 scheme
  if (config.networks && config.networks.length > 0) {
    // Register specific networks
    config.networks.forEach(network => {
      facilitator.register(network, scheme);
    });
  } else {
    // Register wildcard for all Concordium chains
    facilitator.register("ccd:*", scheme);
  }

  // Register all V1 networks
  const v1Scheme = new ExactConcordiumSchemeV1({
    nodeClient: config.nodeClient,
    requireFinalization: config.requireFinalization,
    finalizationTimeoutMs: config.finalizationTimeoutMs,
  });

  CONCORDIUM_V1_NETWORKS.forEach(network => {
    facilitator.registerV1(network as Network, v1Scheme);
  });

  return facilitator;
}
