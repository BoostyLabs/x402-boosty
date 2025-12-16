import { describe, it, expect } from "vitest";
import type { ExactConcordiumPayloadV2, ConcordiumNetwork } from "../../src/types";
import {
  CONCORDIUM_V1_NETWORKS,
  V1_TO_V2_NETWORK_MAP,
  V2_TO_V1_NETWORK_MAP,
} from "../../src/types";

describe("Concordium Types", () => {
  describe("ExactConcordiumPayloadV2", () => {
    it("should have correct structure", () => {
      const payload: ExactConcordiumPayloadV2 = {
        txHash: "abc123",
        sender: "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN",
        blockHash: "block456",
      };

      expect(payload.txHash).toBeDefined();
      expect(payload.sender).toBeDefined();
      expect(payload.blockHash).toBeDefined();
    });

    it("should allow optional blockHash", () => {
      const payload: ExactConcordiumPayloadV2 = {
        txHash: "abc123",
        sender: "3kBx2h5Y2veb4hZvAE2c1Zr6DYJwWbPr9xQJJBPWyFnXHF9UuN",
      };

      expect(payload.blockHash).toBeUndefined();
    });
  });

  describe("ConcordiumNetwork", () => {
    it("should follow CAIP-2 format", () => {
      const mainnet: ConcordiumNetwork = "ccd:9dd9ca4d19e9393877d2c44b70f89acb";
      const testnet: ConcordiumNetwork = "ccd:4221332d34e1694168c2a0c0b3fd0f27";

      expect(mainnet.startsWith("ccd:")).toBe(true);
      expect(testnet.startsWith("ccd:")).toBe(true);
    });
  });

  describe("V1 Network Constants", () => {
    it("should have concordium and concordium-testnet", () => {
      expect(CONCORDIUM_V1_NETWORKS).toContain("concordium");
      expect(CONCORDIUM_V1_NETWORKS).toContain("concordium-testnet");
    });
  });

  describe("Network Mappings", () => {
    it("should map V1 to V2 correctly", () => {
      expect(V1_TO_V2_NETWORK_MAP["concordium"]).toBe("ccd:9dd9ca4d19e9393877d2c44b70f89acb");
      expect(V1_TO_V2_NETWORK_MAP["concordium-testnet"]).toBe("ccd:4221332d34e1694168c2a0c0b3fd0f27");
    });

    it("should map V2 to V1 correctly", () => {
      expect(V2_TO_V1_NETWORK_MAP["ccd:9dd9ca4d19e9393877d2c44b70f89acb"]).toBe("concordium");
      expect(V2_TO_V1_NETWORK_MAP["ccd:4221332d34e1694168c2a0c0b3fd0f27"]).toBe("concordium-testnet");
    });
  });
});
