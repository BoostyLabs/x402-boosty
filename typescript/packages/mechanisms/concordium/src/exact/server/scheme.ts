import {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  MoneyParser,
} from "@x402/core/types";
import { convertToTokenAmount, numberToDecimalString, parseMoneyString } from "@x402/core/utils";

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

  /** Custom money parser chain — tried in registration order before default */
  private moneyParsers: MoneyParser[] = [];

  /**
   * Register an asset for a network.
   *
   * @param network - Network identifier (e.g., "ccd:9dd9ca4d..." or "ccd:*")
   * @param symbol - Asset symbol (e.g., "EURR", "USDC")
   * @param decimals - Number of decimal places
   * @returns This instance for chaining
   * @example
   * ```TypeScript
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
   * Registers a custom money parser in the parser chain.
   *
   * Parsers are tried in registration order. Return `null` to skip to the
   * next parser. The built-in CCD conversion is always the final fallback.
   *
   * @param parser - Custom function returning AssetAmount or null
   *
   * @returns ExactConcordiumScheme instance
   */
  registerMoneyParser(parser: MoneyParser): this {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Get registered asset.
   *
   * @param network - Network identifier
   * @param symbol - Asset symbol
   * @returns Asset info or undefined if not found
   */
  getAsset(network: Network, symbol: string): ConcordiumAssetInfo | undefined {
    const exact = this.assets.get(this.assetKey(network, symbol));
    if (exact) return exact;

    return this.assets.get(this.assetKey("ccd:*", symbol));
  }

  /**
   * Get all supported assets for a network.
   * Always includes native CCD.
   *
   * @param network - Network identifier
   * @returns Array of supported assets
   */
  getSupportedAssets(network: Network): ConcordiumAssetInfo[] {
    const assets: ConcordiumAssetInfo[] = [CCD_NATIVE];

    for (const [key, asset] of this.assets.entries()) {
      if (key.startsWith(`${network}:`) || key.startsWith("ccd:*:")) {
        if (!assets.some(a => a.symbol === asset.symbol)) {
          assets.push(asset);
        }
      }
    }

    return assets;
  }

  /**
   * Get supported asset symbols for a network.
   * Always includes "CCD".
   *
   * @param network - Network identifier
   * @returns Array of supported symbols
   */
  getSupportedSymbols(network: Network): string[] {
    return this.getSupportedAssets(network).map(a => a.symbol);
  }

  /**
   * Parse price into AssetAmount.
   *
   * Supports:
   * - String/number: "10" or 10 -> CCD with decimals
   * - AssetAmount: { amount: "10", asset: "EURR" } -> PLT without decimals
   *
   * @param price - Price to parse
   * @param network - Network identifier
   * @returns Parsed asset amount
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (this.isAssetAmount(price)) {
      return this.parseAssetAmount(price, network);
    }

    const isUsdPrice = typeof price === "string" && price.startsWith("$");

    const amount = this.parseMoneyToDecimal(price);

    for (const parser of this.moneyParsers) {
      const result = await parser(amount, network);
      if (result !== null) return result;
    }

    if (isUsdPrice) {
      throw new Error(`USD prices not supported. Got: ${price}`);
    }

    return {
      amount: convertToTokenAmount(numberToDecimalString(amount), CCD_NATIVE.decimals),
      asset: "CCD",
    };
  }

  /**
   * Enhance payment requirements with facilitator-announced fee payer metadata.
   *
   * @param requirements - Payment requirements to enhance
   * @param supportedKind - Supported payment kind configuration
   * @param supportedKind.x402Version - X402 protocol version
   * @param supportedKind.scheme - Payment scheme identifier
   * @param supportedKind.network - Network identifier
   * @param supportedKind.extra - Extra facilitator metadata
   * @param _ - Extension keys to apply (unused)
   * @returns Enhanced payment requirements
   */
  enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    _: string[],
  ): Promise<PaymentRequirements> {
    return Promise.resolve({
      ...requirements,
      extra: {
        ...((requirements.extra as Record<string, unknown>) ?? {}),
        feePayer: supportedKind.extra?.feePayer,
      },
    });
  }

  /**
   * Parse custom asset amount.
   *
   * @param price - Asset amount to parse
   * @param network - Network identifier
   * @returns Parsed asset amount
   */
  private parseAssetAmount(price: AssetAmount, network: Network): AssetAmount {
    const assetSymbol = price.asset || "";

    if (!assetSymbol || assetSymbol.toUpperCase() === "CCD") {
      const amount = convertToTokenAmount(String(price.amount), CCD_NATIVE.decimals);
      return {
        amount,
        asset: "CCD",
        extra: price.extra,
      };
    }

    const asset = this.getAsset(network, assetSymbol);
    if (!asset) {
      throw new Error(`Unknown asset: ${assetSymbol}`);
    }

    return {
      amount: convertToTokenAmount(String(price.amount), asset.decimals),
      asset: asset.symbol,
      extra: price.extra,
    };
  }

  /**
   * Creates a unique key for asset lookup.
   *
   * @param network - Network identifier
   * @param symbol - Asset symbol
   * @returns Asset key string
   */
  private assetKey(network: Network, symbol: string): string {
    return `${network}:${symbol.toUpperCase()}`;
  }

  /**
   * Convert to whole units (for PLT).
   *
   * @param amount - Amount to convert
   * @returns Whole units as string
   * @example
   * toWholeUnits("10.5") // "10"
   */
  private toWholeUnits(amount: string | number): string {
    const str = String(amount).trim();

    if (!/^\d+(\.\d+)?$/.test(str)) {
      throw new Error(`Invalid amount: ${amount}`);
    }

    const [whole] = str.split(".");
    return whole.replace(/^0+/, "") || "0";
  }

  /**
   * Parses Money (string | number) to a plain decimal number.
   * Strips leading `$` if present (though USD prices are rejected upstream).
   *
   * @param money - Raw price to parse
   * @returns formatted decimal number
   */
  private parseMoneyToDecimal(money: string | number): number {
    if (typeof money === "number") return money;
    return parseMoneyString(money);
  }

  /**
   * Type guard to check if price is an AssetAmount.
   *
   * @param price - Price to check
   * @returns True if price is an AssetAmount
   */
  private isAssetAmount(price: Price): price is AssetAmount {
    return typeof price === "object" && price !== null && "amount" in price;
  }
}
