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
export type AssetType = "native" | "plt";

export interface ConcordiumAssetInfo {
  type: AssetType;
  symbol: string;
  decimals: number;
}

/**
 * Native CCD asset
 */
export const CCD_NATIVE: ConcordiumAssetInfo = {
  type: "native",
  symbol: "CCD",
  decimals: 6,
};

/**
 * Concordium server scheme for exact payments.
 *
 * Supports:
 * - Native CCD (type: "native")
 * - PLT tokens (type: "plt")
 */
export class ExactConcordiumScheme implements SchemeNetworkServer {
  readonly scheme = "exact";

  /** Registered assets: Map<"network:SYMBOL", AssetInfo> */
  private assets = new Map<string, ConcordiumAssetInfo>();

  /**
   * Register an asset for a network.
   *
   * @param network - Network identifier (e.g., "ccd:9dd9ca4d..." or "ccd:*")
   * @param symbol - Asset symbol (e.g., "EURR", "USDC")
   * @param decimals - Decimals
   *
   * @example
   * ```typescript
   * scheme.registerAsset('ccd:9dd9ca4d19e9393877d2c44b70f89acb', 'EURR', 6);
   * ```
   */
  registerAsset(network: Network, symbol: string, decimals: number): this {
    const asset: ConcordiumAssetInfo = {
      type: "plt",
      symbol: symbol.toUpperCase(),
      decimals,
    };
    this.assets.set(this.assetKey(network, symbol), asset);
    return this;
  }

  /**
   * Get registered asset.
   *
   * @param network
   * @param symbol
   */
  getAsset(network: Network, symbol: string): ConcordiumAssetInfo | undefined {
    const exact = this.assets.get(this.assetKey(network, symbol));
    if (exact) return exact;

    return this.assets.get(this.assetKey("ccd:*", symbol));
  }

  /**
   * Get all supported assets for a network.
   * Always includes native CCD.
   */
  getSupportedAssets(network: Network): ConcordiumAssetInfo[] {
    const assets: ConcordiumAssetInfo[] = [CCD_NATIVE];

    for (const [key, asset] of this.assets.entries()) {
      if (key.startsWith(`${network}:`) || key.startsWith("ccd:*:")) {
        // Avoid duplicates
        if (!assets.some((a) => a.symbol === asset.symbol)) {
          assets.push(asset);
        }
      }
    }

    return assets;
  }

  /**
   * Get supported asset symbols for a network.
   * Always includes "CCD".
   */
  getSupportedSymbols(network: Network): string[] {
    return this.getSupportedAssets(network).map((a) => a.symbol);
  }

  /**
   * Parse price into AssetAmount.
   *
   * Supports:
   * - String/number: "10" or 10 -> CCD with decimals
   * - AssetAmount: { amount: "10", asset: "EURR" } -> PLT without decimals
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (this.isAssetAmount(price)) {
      return this.parseAssetAmount(price, network);
    }

    if (typeof price === "string" && price.startsWith("$")) {
      throw new Error(`USD prices not supported. Got: ${price}`);
    }

    const amount = this.toSmallestUnits(price, CCD_NATIVE.decimals);

    return {
      amount,
      asset: "",
      extra: { type: "native", symbol: "CCD", decimals: 6 },
    };
  }

  /**
   * Parse custom asset amount
   */
  private parseAssetAmount(price: AssetAmount, network: Network): AssetAmount {
    const assetSymbol = price.asset || "";

    if (!assetSymbol || assetSymbol.toUpperCase() === "CCD") {
      const amount = this.toSmallestUnits(price.amount, CCD_NATIVE.decimals);
      return {
        amount,
        asset: "",
        extra: {
          type: "native",
          symbol: "CCD",
          decimals: 6,
          ...price.extra,
        },
      };
    }

    const asset = this.getAsset(network, assetSymbol);
    if (!asset) {
      throw new Error(`Unknown asset: ${assetSymbol}`);
    }

    return {
      amount: this.toWholeUnits(price.amount),
      asset: asset.symbol,
      extra: {
        type: asset.type,
        symbol: asset.symbol,
        decimals: asset.decimals,
        ...price.extra,
      },
    };
  }

  /**
   * Enhance payment requirements (no-op for Concordium).
   *
   * @param requirements
   * @param _supportedKind
   * @param _supportedKind.x402Version
   * @param _supportedKind.scheme
   * @param _supportedKind.network
   * @param _supportedKind.extra
   * @param _extensionKeys
   */
  enhancePaymentRequirements(
    requirements: PaymentRequirements,
    _supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    _extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    return Promise.resolve(requirements);
  }

  /**
   *
   * @param network
   * @param symbol
   */
  private assetKey(network: Network, symbol: string): string {
    return `${network}:${symbol.toUpperCase()}`;
  }

  /**
   *
   * @param network
   * @param extra
   */
  private resolveAsset(network: Network, extra?: Record<string, unknown>): ConcordiumAssetInfo {
    if (!extra?.asset) {
      return CCD_NATIVE;
    }

    const symbol = extra.asset;

    if (typeof symbol !== "string") {
      throw new Error(`extra.asset must be a string symbol. Got: ${typeof symbol}`);
    }

    if (symbol.toUpperCase() === "CCD") {
      return CCD_NATIVE;
    }

    const asset = this.getAsset(network, symbol);
    if (!asset) {
      const supported = this.getSupportedSymbols(network);
      throw new Error(
        `Unknown asset "${symbol}" on ${network}. ` +
          `Registered: CCD${supported.length ? ", " + supported.join(", ") : ""}. ` +
          `Use registerAsset() to add.`,
      );
    }

    return asset;
  }

  /**
   * Convert human-readable amount to the smallest units.
   *
   * @example
   * toSmallestUnits("10", 6) // "10000000"
   * toSmallestUnits("10.5", 6) // "10500000"
   * toSmallestUnits(10, 6) // "10000000"
   */
  private toSmallestUnits(amount: string | number, decimals: number): string {
    const str = String(amount).trim();

    if (!/^\d+(\.\d+)?$/.test(str)) {
      throw new Error(`Invalid amount: ${amount}`);
    }

    const [whole, fraction = ""] = str.split(".");
    const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);

    return (whole + paddedFraction).replace(/^0+/, "") || "0";
  }

  /**
   * Convert to whole units (for PLT).
   * 10 PLT -> 10 (no decimals)
   */
  private toWholeUnits(amount: string | number): string {
    const str = String(amount).trim();

    if (!/^\d+(\.\d+)?$/.test(str)) {
      throw new Error(`Invalid amount: ${amount}`);
    }

    // Truncate any decimals
    const [whole] = str.split(".");

    return whole.replace(/^0+/, "") || "0";
  }

  /**
   * Convert the smallest units to human-readable amount.
   *
   * @example
   * fromSmallestUnits("10000000", 6) // "10"
   * fromSmallestUnits("10500000", 6) // "10.5"
   * fromSmallestUnits("1", 6) // "0.000001"
   */
  private fromSmallestUnits(amount: string, decimals: number): string {
    const str = String(amount).trim();

    if (!/^\d+$/.test(str)) {
      throw new Error(`Invalid amount: ${amount}`);
    }

    if (str === "0" || decimals === 0) {
      return str;
    }

    const padded = str.padStart(decimals + 1, "0");
    const whole = padded.slice(0, -decimals).replace(/^0+/, "") || "0";
    const fraction = padded.slice(-decimals).replace(/0+$/, "");

    return fraction ? `${whole}.${fraction}` : whole;
  }

  /**
   *
   * @param price
   */
  private isAssetAmount(
    price: Price,
  ): price is AssetAmount {
    return typeof price === "object" && price !== null && "amount" in price;
  }

  /**
   *
   * @param price
   * @param price.amount
   * @param price.asset
   */
  private validateAssetAmount(price: { amount: string; asset?: string }): void {
    if (!price.amount || !/^\d+$/.test(price.amount)) {
      throw new Error(`Invalid amount: ${price.amount}`);
    }
  }
}
