/**
 * Concordium Client for x402 facilitator.
 *
 * Supports:
 * - Native CCD transfers (transactionType: "transfer")
 * - PLT token transfers (transactionType: "tokenUpdate")
 */

import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import {
  TransactionHash,
  ContractAddress as SDKContractAddress,
  ReceiveName,
  Parameter,
} from "@concordium/web-sdk";

import { getChainConfig } from "../config";

export type TransactionStatus = "pending" | "committed" | "finalized" | "failed";

export interface TransactionInfo {
  txHash: string;
  status: TransactionStatus;
  sender: string;
  recipient?: string;
  amount?: string;
  asset?: string; // "" for CCD, token symbol for PLT (e.g., "EURR")
}

export interface ConcordiumClientConfig {
  host: string;
  port?: number;
  useTls?: boolean;
}

export interface ContractAddress {
  index: bigint;
  subindex: bigint;
}

export interface PaymentVerification {
  valid: boolean;
  reason?: "not_found" | "pending" | "failed" | "recipient_mismatch" | "insufficient_amount" | "asset_mismatch";
  info?: TransactionInfo;
}

/**
 *
 */
export class ConcordiumClient {
  private config: Required<ConcordiumClientConfig>;
  private client: ConcordiumGRPCNodeClient | null = null;

  /**
   *
   * @param config
   */
  constructor(config: ConcordiumClientConfig) {
    this.config = {
      host: config.host,
      port: config.port ?? 20000,
      useTls: config.useTls ?? true,
    };
  }

  /**
   *
   * @param network
   */
  static fromNetwork(network: string): ConcordiumClient {
    const chain = getChainConfig(network);
    if (!chain) {
      throw new Error(`Unknown network: ${network}`);
    }

    const [host, port] = chain.grpcUrl.split(":");
    return new ConcordiumClient({
      host,
      port: parseInt(port, 10) || 20000,
    });
  }

  /**
   * Get transaction status and details.
   * Supports both CCD transfers and PLT token transfers.
   */
  async getTransactionStatus(txHash: string): Promise<TransactionInfo | null> {
    const client = this.getClient();

    try {
      const hash = TransactionHash.fromHexString(txHash);
      const blockStatus = await client.getBlockItemStatus(hash);

      if (!blockStatus) {
        return null;
      }

      const status = this.mapStatus(blockStatus.status);
      const summary = (blockStatus as any).outcome?.summary;

      if (!summary) {
        return { txHash, status, sender: "" };
      }

      const sender = summary.sender ?? "";
      const transactionType = summary.transactionType;

      // CCD transfer
      if (transactionType === "transfer" && summary.transfer) {
        return {
          txHash,
          status,
          sender,
          recipient: summary.transfer.to,
          amount: summary.transfer.amount?.toString(),
          asset: "", // Native CCD
        };
      }

      // PLT token transfer
      if (transactionType === "tokenUpdate" && summary.events?.length > 0) {
        const transferEvent = summary.events.find(
          (e: any) => e.tag === "TokenTransfer",
        );

        if (transferEvent) {
          return {
            txHash,
            status,
            sender,
            recipient: transferEvent.to?.address,
            amount: transferEvent.amount?.value?.toString(),
            asset: transferEvent.tokenId,
          };
        }
      }

      return { txHash, status, sender };
    } catch {
      return null;
    }
  }

  /**
   * Wait for transaction finalization.
   * @param txHash
   * @param timeoutMs
   */
  async waitForFinalization(
    txHash: string,
    timeoutMs: number = 60000,
  ): Promise<TransactionInfo | null> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const info = await this.getTransactionStatus(txHash);

      if (!info) return null;
      if (info.status === "finalized" || info.status === "failed") {
        return info;
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    return this.getTransactionStatus(txHash);
  }

  /**
   *
   * @param txHash
   * @param expected
   * @param expected.recipient
   * @param expected.minAmount
   */
  async verifyPayment(
    txHash: string,
    expected: { recipient: string; minAmount: bigint; asset?: string },
  ): Promise<PaymentVerification> {
    const info = await this.getTransactionStatus(txHash);

    if (!info) {
      return { valid: false, reason: "not_found" };
    }

    if (info.status === "failed") {
      return { valid: false, reason: "failed", info };
    }

    if (info.status === "pending") {
      return { valid: false, reason: "pending", info };
    }

    if (!info.recipient || !this.addressEquals(info.recipient, expected.recipient)) {
      return { valid: false, reason: "recipient_mismatch", info };
    }

    if (BigInt(info.amount ?? "0") < expected.minAmount) {
      return { valid: false, reason: "insufficient_amount", info };
    }

    const expectedAsset = expected.asset ?? "";
    const actualAsset = info.asset ?? "";
    if (expectedAsset !== actualAsset) {
      return { valid: false, reason: "asset_mismatch", info };
    }

    return { valid: true, info };
  }

  /**
   *
   * @param contract
   * @param method
   * @param params
   */
  async invokeContract(
    contract: ContractAddress,
    method: string,
    params?: Uint8Array,
  ): Promise<{ success: boolean; returnValue?: Uint8Array; error?: string }> {
    const client = this.getClient();

    try {
      const address = SDKContractAddress.create(contract.index, contract.subindex);

      const result = await client.invokeContract({
        contract: address,
        method: ReceiveName.fromString(method),
        parameter: params ? Parameter.fromBuffer(params) : undefined,
      });

      if (result.tag === "failure") {
        return { success: false, error: String(result.reason) };
      }

      return {
        success: true,
        returnValue: result.returnValue?.buffer
          ? new Uint8Array(result.returnValue.buffer)
          : undefined,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Closing connection to gRPC node
   */
  close(): void {
    this.client?.close?.();
    this.client = null;
  }

  /**
   * Get gRPC client instance
   */
  private getClient(): ConcordiumGRPCNodeClient {
    if (!this.client) {
      const grpcCredentials = this.config.useTls
        ? credentials.createSsl()
        : credentials.createInsecure();

      this.client = new ConcordiumGRPCNodeClient(
        this.config.host,
        this.config.port,
        grpcCredentials,
      );
    }

    return this.client;
  }

  /**
   * Map tx status
   */
  private mapStatus(status: string): TransactionStatus {
    switch (status) {
      case "finalized":
        return "finalized";
      case "committed":
        return "committed";
      default:
        return "pending";
    }
  }

  /**
   * Helper
   */
  private addressEquals(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }
}
