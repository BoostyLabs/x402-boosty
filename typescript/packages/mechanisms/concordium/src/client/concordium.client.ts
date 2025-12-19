/**
 * Concordium Client for x402 facilitator.
 *
 * Methods:
 * - getTransactionStatus(txHash)
 * - waitForFinalization(txHash)
 * - verifyPayment(txHash, expected)
 * - invokeContract(contract, method, params)
 */

import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import {
  TransactionHash,
  ContractAddress as SDKContractAddress,
  ReceiveName,
  Parameter,
} from "@concordium/web-sdk";

import { getChainConfig } from "../config";

export enum TransactionStatusEnum {
  Received = "received",
  Finalized = "finalized",
  Committed = "committed",
}

export type TransactionStatus = "pending" | "committed" | "finalized" | "failed";

export interface TransactionInfo {
  txHash: string;
  status: TransactionStatus;
  sender: string;
  recipient?: string;
  amount?: string;
  contractIndex?: bigint;
  contractSubindex?: bigint;
  error?: string;
}

export interface ConcordiumClientConfig {
  host: string;
  port?: number;
  useTls?: boolean;
  timeoutMs?: number;
}

export interface ContractAddress {
  index: bigint;
  subindex: bigint;
}

export interface PaymentVerification {
  valid: boolean;
  reason?: "not_found" | "pending" | "failed" | "recipient_mismatch" | "insufficient_amount";
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
      timeoutMs: config.timeoutMs ?? 30000,
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
   *
   * @param txHash
   */
  async getTransactionStatus(txHash: string): Promise<TransactionInfo> {
    const client = this.getClient();
    const hash = TransactionHash.fromHexString(txHash);

    const blockStatus = await client.getBlockItemStatus(hash);

    if (!blockStatus) {
      return {
        txHash,
        status: "pending",
        sender: "",
        recipient: "",
        amount: "",
      };
    }

    const s = blockStatus as Record<string, any>;

    const sender = s.outcome?.summary?.sender?.address ?? "";
    const recipient = s.outcome?.summary?.transfer?.to?.address ?? "";
    const amount = s.outcome?.summary?.transfer?.amount?.microCcdAmount?.toString() ?? "";

    let status: TransactionStatus;
    switch (blockStatus.status) {
      case TransactionStatusEnum.Finalized:
        status = "finalized";
        break;
      case TransactionStatusEnum.Committed:
        status = "committed";
        break;
      case TransactionStatusEnum.Received:
      default:
        status = "pending";
        break;
    }

    return {
      txHash,
      status,
      sender,
      recipient,
      amount,
    };
  }

  /**
   *
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
    expected: { recipient: string; minAmount: bigint },
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

    if (!info.recipient || info.recipient !== expected.recipient) {
      return { valid: false, reason: "recipient_mismatch", info };
    }

    if (BigInt(info.amount ?? "0") < expected.minAmount) {
      return { valid: false, reason: "insufficient_amount", info };
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
   *
   */
  close(): void {
    this.client?.close?.();
    this.client = null;
  }

  /**
   *
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
}
