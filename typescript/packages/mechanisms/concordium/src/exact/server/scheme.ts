import {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  MoneyParser,
} from "@x402/core/types";
import { CCD_NATIVE_ASSET, ConcordiumAssetInfo } from "../../types";

/**
 * Concordium server implementation for the Exact payment scheme.
 *
 * This handles building payment requirements for Concordium payments.
 * The server doesn't need a signer since verification happens on the facilitator.
 */
export class ExactConcordiumScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  private moneyParsers: MoneyParser[] = [];
  private customAssets: Map<string, ConcordiumAssetInfo> = new Map();

  /**
   * Register a custom asset for a network.
   *
   * @param network - The network identifier
   * @param asset - The asset information
   * @returns The server instance for chaining
   */
  registerAsset(network: Network, asset: ConcordiumAssetInfo): ExactConcordiumScheme {
    this.customAssets.set(network, asset);
    return this;
  }

  /**
   * Register a custom money parser in the parser chain.
   * Multiple parsers can be registered - they will be tried in registration order.
   * Each parser receives a decimal amount (e.g., 1.50 for $1.50).
   * If a parser returns null, the next parser in the chain will be tried.
   * The default parser is always the final fallback.
   *
   * @param parser - Custom function to convert amount to AssetAmount (or null to skip)
   * @returns The server instance for chaining
   */
  registerMoneyParser(parser: MoneyParser): ExactConcordiumScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  /**
   * Parses a price into an asset amount.
   * If price is already an AssetAmount, returns it directly.
   * If price is Money (string | number), parses to decimal and tries custom parsers.
   * Falls back to default conversion if all custom parsers return null.
   *
   * @param price - The price to parse
   * @param network - The network to use
   * @returns Promise that resolves to the parsed asset amount
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    // If already an AssetAmount, return it directly
    if (typeof price === "object" && price !== null && "amount" in price) {
      return {
        amount: price.amount,
        asset: price.asset || "", // Empty string for native CCD
        extra: price.extra || {},
      };
    }

    // Parse Money to decimal number
    const amount = this.parseMoneyToDecimal(price);

    // Try each custom money parser in order
    for (const parser of this.moneyParsers) {
      const result = await parser(amount, network);
      if (result !== null) {
        return result;
      }
    }

    // All custom parsers returned null, use default conversion (native CCD)
    return this.defaultMoneyConversion(amount, network);
  }

  /**
   * Build payment requirements for this scheme/network combination
   *
   * @param paymentRequirements - The base payment requirements
   * @param supportedKind - The supported kind from facilitator
   * @param extensionKeys - Extension keys supported by the facilitator
   * @returns Payment requirements ready to be sent to clients
   */
  enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    // Mark unused parameters to satisfy linter
    void supportedKind;
    void extensionKeys;
    return Promise.resolve(paymentRequirements);
  }

  /**
   * Parse Money (string | number) to a decimal number.
   * Handles formats like "$1.50", "1.50", 1.50, etc.
   *
   * @param money - The money value to parse
   * @returns Decimal number
   */
  private parseMoneyToDecimal(money: string | number): number {
    if (typeof money === "number") {
      return money;
    }

    // Remove currency symbols and whitespace, then parse
    const cleanMoney = money.replace(/^[$€£]/, "").trim();
    const amount = parseFloat(cleanMoney);

    if (isNaN(amount)) {
      throw new Error(`Invalid money format: ${money}`);
    }

    return amount;
  }

  /**
   * Default money conversion implementation.
   * Converts decimal amount to native CCD on the specified network.
   *
   * @param amount - The decimal amount (e.g., 1.50)
   * @param network - The network to use
   * @returns The parsed asset amount in CCD
   */
  private defaultMoneyConversion(amount: number, network: Network): AssetAmount {
    // Check for custom asset first
    const customAsset = this.customAssets.get(network);
    const assetInfo = customAsset || CCD_NATIVE_ASSET;

    // Convert decimal amount to token amount
    const tokenAmount = this.convertToTokenAmount(amount, assetInfo.decimals);

    return {
      amount: tokenAmount,
      asset: assetInfo.contractIndex
        ? `${assetInfo.contractIndex}:${assetInfo.contractSubindex}:${assetInfo.tokenId}`
        : "", // Empty string for native CCD
      extra: {
        name: assetInfo.name,
        decimals: assetInfo.decimals,
      },
    };
  }

  /**
   * Convert decimal amount to token units
   *
   * @param decimalAmount - The decimal amount to convert
   * @param decimals - The number of decimals for the asset
   * @returns The token amount as a string
   */
  private convertToTokenAmount(decimalAmount: number, decimals: number): string {
    // Convert to smallest unit
    const tokenAmount = Math.floor(decimalAmount * Math.pow(10, decimals));
    return tokenAmount.toString();
  }
}