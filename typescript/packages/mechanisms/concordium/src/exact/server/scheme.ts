import {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from "@x402/core/types";

/**
 * Concordium asset information
 */
export interface ConcordiumAssetInfo {
  /** Contract index (empty string for native CCD) */
  contractIndex: string;
  /** Contract subindex */
  contractSubindex: string;
  /** Token ID */
  tokenId: string;
  /** Human-readable name */
  name: string;
  /** Number of decimals */
  decimals: number;
}

/**
 * Native CCD asset
 */
export const CCD_NATIVE: ConcordiumAssetInfo = {
  contractIndex: "",
  contractSubindex: "",
  tokenId: "",
  name: "CCD",
  decimals: 6,
};

/**
 * Concordium server scheme for exact payments.
 *
 * Asset resolution (strict order):
 * 1. extra.asset (string symbol) -> lookup in registered assets
 * 2. No extra.asset -> native CCD
 *
 * Price formats:
 * - Number: 1.5 (uses resolved asset decimals)
 * - String: "1.5" (uses resolved asset decimals)
 *
 * USD prices ($) are NOT supported - use explicit asset.
 */
export class ExactConcordiumScheme implements SchemeNetworkServer {
  readonly scheme = "exact";

  /** Registered assets: Map<"network:SYMBOL", AssetInfo> */
  private assets = new Map<string, ConcordiumAssetInfo>();

  /**
   * Register an asset for a network.
   *
   * @param network - Network identifier (e.g., "ccd:9dd9ca4d..." or "ccd:*")
   * @param symbol - Asset symbol (e.g., "EUROe", "USDC")
   * @param asset - Asset information
   *
   * @example
   * ```typescript
   * scheme.registerAsset('ccd:9dd9ca4d19e9393877d2c44b70f89acb', 'EUROe', {
   *   contractIndex: '9390',
   *   contractSubindex: '0',
   *   tokenId: '',
   *   name: 'EUROe Stablecoin',
   *   decimals: 6,
   * });
   * ```
   */
  registerAsset(
    network: Network,
    symbol: string,
    asset: ConcordiumAssetInfo,
  ): this {
    const key = this.assetKey(network, symbol);
    this.assets.set(key, asset);
    return this;
  }

  /**
   * Get registered asset.
   */
  getAsset(network: Network, symbol: string): ConcordiumAssetInfo | undefined {
    // Try exact network match
    const exact = this.assets.get(this.assetKey(network, symbol));
    if (exact) return exact;

    // Try wildcard
    return this.assets.get(this.assetKey("ccd:*", symbol));
  }

  /**
   * Parse price into AssetAmount.
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    // Already AssetAmount - pass through
    if (this.isAssetAmount(price)) {
      this.validateAssetAmount(price);
      return {
        amount: price.amount,
        asset: price.asset || "",
        extra: price.extra || {},
      };
    }

    // Reject USD prices
    if (typeof price === "string" && price.startsWith("$")) {
      throw new Error(
        `USD prices not supported. Use explicit asset in extra.asset. Got: ${price}`
      );
    }

    // Default to CCD (extra.asset handled in parseWithExtra)
    const amount = this.toSmallestUnits(price, CCD_NATIVE.decimals);

    return {
      amount,
      asset: "",
      extra: { name: "CCD", decimals: 6 },
    };
  }

  /**
   * Parse price with extra metadata (called by your middleware).
   * This is the main entry point that handles extra.asset.
   */
  parsePriceWithExtra(
    price: Price,
    network: Network,
    extra?: Record<string, unknown>,
  ): AssetAmount {
    // Already AssetAmount
    if (this.isAssetAmount(price)) {
      this.validateAssetAmount(price);
      return {
        amount: price.amount,
        asset: price.asset || "",
        extra: price.extra || {},
      };
    }

    // Reject USD prices
    if (typeof price === "string" && price.startsWith("$")) {
      throw new Error(
        `USD prices not supported. Use explicit asset in extra.asset. Got: ${price}`
      );
    }

    // Resolve asset
    const asset = this.resolveAsset(network, extra);

    // Convert price
    const amount = this.toSmallestUnits(price, asset.decimals);

    // Build asset string
    const assetString = asset.contractIndex
      ? `${asset.contractIndex}:${asset.contractSubindex}:${asset.tokenId}`
      : "";

    return {
      amount,
      asset: assetString,
      extra: {
        name: asset.name,
        decimals: asset.decimals,
        ...(asset.contractIndex && {
          contractIndex: asset.contractIndex,
          contractSubindex: asset.contractSubindex,
          tokenId: asset.tokenId,
        }),
      },
    };
  }

  /**
   * Enhance payment requirements (no-op for Concordium).
   */
  enhancePaymentRequirements(
    requirements: PaymentRequirements,
    _supportedKind: { x402Version: number; scheme: string; network: Network; extra?: Record<string, unknown> },
    _extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    return Promise.resolve(requirements);
  }

  private assetKey(network: Network, symbol: string): string {
    return `${network}:${symbol.toUpperCase()}`;
  }

  private resolveAsset(
    network: Network,
    extra?: Record<string, unknown>,
  ): ConcordiumAssetInfo {
    // No extra.asset -> native CCD
    if (!extra?.asset) {
      return CCD_NATIVE;
    }

    const symbol = extra.asset;

    // Must be string symbol
    if (typeof symbol !== "string") {
      throw new Error(
        `extra.asset must be a string symbol. Got: ${typeof symbol}`
      );
    }

    // Native CCD
    if (symbol.toUpperCase() === "CCD") {
      return CCD_NATIVE;
    }

    // Lookup registered asset
    const asset = this.getAsset(network, symbol);
    if (!asset) {
      const registered = this.listRegisteredSymbols(network);
      throw new Error(
        `Unknown asset "${symbol}" on ${network}. ` +
        `Registered: CCD${registered.length ? ", " + registered.join(", ") : ""}. ` +
        `Use registerAsset() to add.`
      );
    }

    return asset;
  }

  private listRegisteredSymbols(network: Network): string[] {
    const symbols: string[] = [];

    for (const key of this.assets.keys()) {
      if (key.startsWith(`${network}:`) || key.startsWith("ccd:*:")) {
        const symbol = key.split(":").pop();
        if (symbol) symbols.push(symbol);
      }
    }

    return [...new Set(symbols)];
  }

  private toSmallestUnits(price: string | number, decimals: number): string {
    const value = typeof price === "string" ? parseFloat(price) : price;

    if (isNaN(value) || value < 0) {
      throw new Error(`Invalid price: ${price}`);
    }

    const smallest = Math.floor(value * Math.pow(10, decimals));
    return smallest.toString();
  }

  private isAssetAmount(price: Price): price is { amount: string; asset?: string; extra?: Record<string, unknown> } {
    return typeof price === "object" && price !== null && "amount" in price;
  }

  private validateAssetAmount(price: { amount: string; asset?: string }): void {
    if (!price.amount || isNaN(Number(price.amount))) {
      throw new Error(`Invalid amount: ${price.amount}`);
    }
    if (Number(price.amount) < 0) {
      throw new Error(`Amount cannot be negative: ${price.amount}`);
    }
  }
}
