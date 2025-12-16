import { describe, it, expect } from "vitest";

// Chains imports
import {
  CONCORDIUM_CHAINS,
  CONCORDIUM_CHAINS_BY_CAIP2,
  CONCORDIUM_MAINNET,
  CONCORDIUM_TESTNET,
  getChainConfig,
  getChainConfigOrThrow,
  v1ToV2Network,
  v2ToV1Network,
  getExplorerTxUrl,
  getExplorerAccountUrl,
} from "../../src/config/chains";

// Tokens imports
import {
  MAINNET_TOKENS,
  TESTNET_TOKENS,
  TOKEN_REGISTRIES,
  TOKEN_REGISTRIES_V1,
  getTokenRegistry,
  getTokenBySymbol,
  getTokenByContract,
  getStablecoins,
  formatAssetString,
  parseAssetString,
  isNativeCCD,
} from "../../src/config/tokens";

describe("Concordium Config", () => {
  describe("chains", () => {
    describe("CONCORDIUM_MAINNET", () => {
      it("should have correct config", () => {
        expect(CONCORDIUM_MAINNET.name).toBe("Concordium Mainnet");
        expect(CONCORDIUM_MAINNET.networkId).toBe("mainnet");
        expect(CONCORDIUM_MAINNET.network).toBe("ccd:9dd9ca4d19e9393877d2c44b70f89acb");
        expect(CONCORDIUM_MAINNET.v1Network).toBe("concordium");
        expect(CONCORDIUM_MAINNET.nativeToken.symbol).toBe("CCD");
        expect(CONCORDIUM_MAINNET.nativeToken.decimals).toBe(6);
      });
    });

    describe("CONCORDIUM_TESTNET", () => {
      it("should have correct config", () => {
        expect(CONCORDIUM_TESTNET.name).toBe("Concordium Testnet");
        expect(CONCORDIUM_TESTNET.networkId).toBe("testnet");
        expect(CONCORDIUM_TESTNET.network).toBe("ccd:4221332d34e1694168c2a0c0b3fd0f27");
        expect(CONCORDIUM_TESTNET.v1Network).toBe("concordium-testnet");
      });
    });

    describe("CONCORDIUM_CHAINS", () => {
      it("should index by V1 names", () => {
        expect(CONCORDIUM_CHAINS["concordium"]).toBe(CONCORDIUM_MAINNET);
        expect(CONCORDIUM_CHAINS["concordium-testnet"]).toBe(CONCORDIUM_TESTNET);
      });
    });

    describe("CONCORDIUM_CHAINS_BY_CAIP2", () => {
      it("should index by CAIP-2", () => {
        expect(CONCORDIUM_CHAINS_BY_CAIP2["ccd:9dd9ca4d19e9393877d2c44b70f89acb"]).toBe(CONCORDIUM_MAINNET);
        expect(CONCORDIUM_CHAINS_BY_CAIP2["ccd:4221332d34e1694168c2a0c0b3fd0f27"]).toBe(CONCORDIUM_TESTNET);
      });
    });

    describe("getChainConfig", () => {
      it("should return config for V1 names", () => {
        expect(getChainConfig("concordium")).toBe(CONCORDIUM_MAINNET);
        expect(getChainConfig("concordium-testnet")).toBe(CONCORDIUM_TESTNET);
      });

      it("should return config for V2 CAIP-2", () => {
        expect(getChainConfig("ccd:9dd9ca4d19e9393877d2c44b70f89acb")).toBe(CONCORDIUM_MAINNET);
        expect(getChainConfig("ccd:4221332d34e1694168c2a0c0b3fd0f27")).toBe(CONCORDIUM_TESTNET);
      });

      it("should return undefined for unknown", () => {
        expect(getChainConfig("unknown")).toBeUndefined();
        expect(getChainConfig("ccd:unknown")).toBeUndefined();
      });
    });

    describe("getChainConfigOrThrow", () => {
      it("should return config for valid network", () => {
        expect(getChainConfigOrThrow("concordium")).toBe(CONCORDIUM_MAINNET);
      });

      it("should throw for unknown network", () => {
        expect(() => getChainConfigOrThrow("unknown")).toThrow("Unknown Concordium network");
      });
    });

    describe("v1ToV2Network", () => {
      it("should convert V1 to CAIP-2", () => {
        expect(v1ToV2Network("concordium")).toBe("ccd:9dd9ca4d19e9393877d2c44b70f89acb");
        expect(v1ToV2Network("concordium-testnet")).toBe("ccd:4221332d34e1694168c2a0c0b3fd0f27");
      });

      it("should return undefined for unknown", () => {
        expect(v1ToV2Network("unknown")).toBeUndefined();
      });
    });

    describe("v2ToV1Network", () => {
      it("should convert CAIP-2 to V1", () => {
        expect(v2ToV1Network("ccd:9dd9ca4d19e9393877d2c44b70f89acb")).toBe("concordium");
        expect(v2ToV1Network("ccd:4221332d34e1694168c2a0c0b3fd0f27")).toBe("concordium-testnet");
      });

      it("should return undefined for unknown", () => {
        expect(v2ToV1Network("ccd:unknown")).toBeUndefined();
      });
    });

    describe("getExplorerTxUrl", () => {
      it("should return transaction URL", () => {
        expect(getExplorerTxUrl("concordium", "tx123")).toBe(
          "https://dashboard.mainnet.concordium.software/transaction/tx123"
        );
        expect(getExplorerTxUrl("concordium-testnet", "tx456")).toBe(
          "https://dashboard.testnet.concordium.software/transaction/tx456"
        );
      });

      it("should return undefined for unknown network", () => {
        expect(getExplorerTxUrl("unknown", "tx")).toBeUndefined();
      });
    });

    describe("getExplorerAccountUrl", () => {
      it("should return account URL", () => {
        expect(getExplorerAccountUrl("concordium", "addr123")).toBe(
          "https://dashboard.mainnet.concordium.software/account/addr123"
        );
      });

      it("should return undefined for unknown network", () => {
        expect(getExplorerAccountUrl("unknown", "addr")).toBeUndefined();
      });
    });
  });

  describe("tokens", () => {
    describe("MAINNET_TOKENS", () => {
      it("should have correct network", () => {
        expect(MAINNET_TOKENS.network).toBe("ccd:9dd9ca4d19e9393877d2c44b70f89acb");
      });

      it("should have native CCD config", () => {
        expect(MAINNET_TOKENS.nativeToken.symbol).toBe("CCD");
        expect(MAINNET_TOKENS.nativeToken.decimals).toBe(6);
      });

      it("should have EUROe token", () => {
        const euroe = MAINNET_TOKENS.tokens.find(t => t.symbol === "EUROe");
        expect(euroe).toBeDefined();
        expect(euroe?.contractIndex).toBe(9390);
        expect(euroe?.type).toBe("stablecoin");
      });
    });

    describe("TESTNET_TOKENS", () => {
      it("should have PLT token", () => {
        const plt = TESTNET_TOKENS.tokens.find(t => t.symbol === "PLT");
        expect(plt).toBeDefined();
        expect(plt?.contractIndex).toBe(7260);
        expect(plt?.type).toBe("platform");
      });
    });

    describe("TOKEN_REGISTRIES", () => {
      it("should index by CAIP-2", () => {
        expect(TOKEN_REGISTRIES["ccd:9dd9ca4d19e9393877d2c44b70f89acb"]).toBe(MAINNET_TOKENS);
        expect(TOKEN_REGISTRIES["ccd:4221332d34e1694168c2a0c0b3fd0f27"]).toBe(TESTNET_TOKENS);
      });
    });

    describe("TOKEN_REGISTRIES_V1", () => {
      it("should index by V1 names", () => {
        expect(TOKEN_REGISTRIES_V1["concordium"]).toBe(MAINNET_TOKENS);
        expect(TOKEN_REGISTRIES_V1["concordium-testnet"]).toBe(TESTNET_TOKENS);
      });
    });

    describe("getTokenRegistry", () => {
      it("should return registry for V1 and V2 networks", () => {
        expect(getTokenRegistry("concordium")).toBe(MAINNET_TOKENS);
        expect(getTokenRegistry("ccd:9dd9ca4d19e9393877d2c44b70f89acb")).toBe(MAINNET_TOKENS);
      });

      it("should return undefined for unknown", () => {
        expect(getTokenRegistry("unknown")).toBeUndefined();
      });
    });

    describe("getTokenBySymbol", () => {
      it("should find EUROe on mainnet", () => {
        const token = getTokenBySymbol("concordium", "EUROe");
        expect(token?.symbol).toBe("EUROe");
        expect(token?.contractIndex).toBe(9390);
      });

      it("should be case-insensitive", () => {
        expect(getTokenBySymbol("concordium", "euroe")).toBeDefined();
        expect(getTokenBySymbol("concordium", "EUROE")).toBeDefined();
      });

      it("should return undefined for unknown token", () => {
        expect(getTokenBySymbol("concordium", "UNKNOWN")).toBeUndefined();
      });

      it("should return undefined for unknown network", () => {
        expect(getTokenBySymbol("unknown", "EUROe")).toBeUndefined();
      });
    });

    describe("getTokenByContract", () => {
      it("should find token by contract index", () => {
        const token = getTokenByContract("concordium", 9390, 0);
        expect(token?.symbol).toBe("EUROe");
      });

      it("should default subindex to 0", () => {
        const token = getTokenByContract("concordium", 9390);
        expect(token?.symbol).toBe("EUROe");
      });

      it("should return undefined for unknown contract", () => {
        expect(getTokenByContract("concordium", 9999)).toBeUndefined();
      });
    });

    describe("getStablecoins", () => {
      it("should return stablecoins on mainnet", () => {
        const stables = getStablecoins("concordium");
        expect(stables.length).toBeGreaterThan(0);
        expect(stables.every(t => t.type === "stablecoin")).toBe(true);
      });

      it("should return empty for network without stablecoins", () => {
        const stables = getStablecoins("concordium-testnet");
        expect(stables.length).toBe(0);
      });

      it("should return empty for unknown network", () => {
        expect(getStablecoins("unknown")).toEqual([]);
      });
    });

    describe("formatAssetString", () => {
      it("should format CIS-2 token", () => {
        const token = MAINNET_TOKENS.tokens[0]; // EUROe
        expect(formatAssetString(token)).toBe("9390:0:");
      });

      it("should include tokenId if present", () => {
        const token = { ...MAINNET_TOKENS.tokens[0], tokenId: "abc" };
        expect(formatAssetString(token)).toBe("9390:0:abc");
      });
    });

    describe("parseAssetString", () => {
      it("should parse empty string as native", () => {
        const result = parseAssetString("");
        expect(result.isNative).toBe(true);
        expect(result.contractIndex).toBeUndefined();
      });

      it("should parse CIS-2 asset string", () => {
        const result = parseAssetString("9390:0:");
        expect(result.isNative).toBe(false);
        expect(result.contractIndex).toBe(9390);
        expect(result.contractSubindex).toBe(0);
        expect(result.tokenId).toBe("");
      });

      it("should parse asset with tokenId", () => {
        const result = parseAssetString("5000:0:mytoken");
        expect(result.contractIndex).toBe(5000);
        expect(result.tokenId).toBe("mytoken");
      });

      it("should treat invalid format as native", () => {
        const result = parseAssetString("invalid");
        expect(result.isNative).toBe(true);
      });
    });

    describe("isNativeCCD", () => {
      it("should return true for empty string", () => {
        expect(isNativeCCD("")).toBe(true);
      });

      it("should return true for undefined/null-like", () => {
        expect(isNativeCCD(undefined as any)).toBe(true);
      });

      it("should return false for CIS-2 asset", () => {
        expect(isNativeCCD("9390:0:")).toBe(false);
      });
    });
  });
});
