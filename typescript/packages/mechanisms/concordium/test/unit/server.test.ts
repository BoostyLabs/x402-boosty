import { describe, it, expect, beforeEach } from "vitest";
import { ExactConcordiumScheme } from "../../src/exact/server/scheme";

describe("ExactConcordiumScheme (Server)", () => {
  let scheme: ExactConcordiumScheme;

  beforeEach(() => {
    scheme = new ExactConcordiumScheme();
  });

  describe("scheme property", () => {
    it("should be 'exact'", () => {
      expect(scheme.scheme).toBe("exact");
    });
  });

  describe("registerAsset", () => {
    it("should register and retrieve asset", () => {
      scheme.registerAsset("ccd:9dd9ca4d19e9393877d2c44b70f89acb", "EUROe", {
        contractIndex: "9390",
        contractSubindex: "0",
        tokenId: "",
        name: "EUROe",
        decimals: 6,
      });

      const asset = scheme.getAsset("ccd:9dd9ca4d19e9393877d2c44b70f89acb", "EUROe");
      expect(asset).toBeDefined();
      expect(asset?.contractIndex).toBe("9390");
    });

    it("should support method chaining", () => {
      const result = scheme
        .registerAsset("ccd:9dd9ca4d19e9393877d2c44b70f89acb", "EUROe", {
          contractIndex: "9390",
          contractSubindex: "0",
          tokenId: "",
          name: "EUROe",
          decimals: 6,
        })
        .registerAsset("ccd:4221332d34e1694168c2a0c0b3fd0f27", "PLT", {
          contractIndex: "7260",
          contractSubindex: "0",
          tokenId: "",
          name: "PLT",
          decimals: 6,
        });

      expect(result).toBe(scheme);
    });
  });

  describe("parsePrice", () => {
    it("should parse number as native CCD", async () => {
      const result = await scheme.parsePrice(1.5, "ccd:9dd9ca4d19e9393877d2c44b70f89acb");

      expect(result.amount).toBe("1500000"); // 1.5 CCD = 1,500,000 microCCD
      expect(result.asset).toBe(""); // Native CCD
    });

    it("should parse string as native CCD", async () => {
      const result = await scheme.parsePrice("2.5", "ccd:9dd9ca4d19e9393877d2c44b70f89acb");

      expect(result.amount).toBe("2500000");
      expect(result.asset).toBe("");
    });

    it("should reject USD prices", async () => {
      await expect(
        scheme.parsePrice("$1.00", "ccd:9dd9ca4d19e9393877d2c44b70f89acb"),
      ).rejects.toThrow();
    });

    it("should pass through pre-parsed objects", async () => {
      const result = await scheme.parsePrice(
        { amount: "123456", asset: "9390:0:", extra: { custom: true } },
        "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
      );

      expect(result.amount).toBe("123456");
      expect(result.asset).toBe("9390:0:");
      expect(result.extra?.custom).toBe(true);
    });
  });

  describe("parsePriceWithExtra", () => {
    beforeEach(() => {
      scheme.registerAsset("ccd:9dd9ca4d19e9393877d2c44b70f89acb", "EUROe", {
        contractIndex: "9390",
        contractSubindex: "0",
        tokenId: "",
        name: "EUROe",
        decimals: 6,
      });
    });

    it("should default to native CCD", () => {
      const result = scheme.parsePriceWithExtra(
        "1.0",
        "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
      );

      expect(result.asset).toBe("");
      expect(result.amount).toBe("1000000");
    });

    it("should lookup registered asset by symbol", () => {
      const result = scheme.parsePriceWithExtra(
        "5.0",
        "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
        { asset: "EUROe" },
      );

      expect(result.asset).toBe("9390:0:");
      expect(result.amount).toBe("5000000");
    });

    it("should throw for unknown asset", () => {
      expect(() =>
        scheme.parsePriceWithExtra(
          "1.0",
          "ccd:9dd9ca4d19e9393877d2c44b70f89acb",
          { asset: "UNKNOWN" },
        ),
      ).toThrow();
    });
  });
});
