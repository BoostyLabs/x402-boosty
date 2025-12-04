import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import { PaymentRequirementsV1 } from "@x402/core/types/v1";
import { ExactConcordiumSchemeConfig } from "../../client/scheme";
import { ExactConcordiumPayloadV1 } from "../../../types";

/**
 * Concordium client implementation for the Exact payment scheme (V1).
 *
 * The client broadcasts the transaction directly from the Concordium wallet
 * and returns the transaction hash in the payload.
 */
export class ExactConcordiumSchemeV1 implements SchemeNetworkClient {
  readonly scheme = "exact";

  constructor(private readonly config: ExactConcordiumSchemeConfig) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<
    Pick<PaymentPayload, "x402Version" | "payload"> & { scheme: string; network: Network }
  > {
    const requirementsV1 = paymentRequirements as unknown as PaymentRequirementsV1;
    const { txHash, sender, blockHash } = await this.config.createAndBroadcastTransaction(
      requirementsV1.payTo,
      requirementsV1.maxAmountRequired,
      requirementsV1.asset,
    );

    const payload: ExactConcordiumPayloadV1 = {
      txHash,
      sender,
      blockHash,
    };

    return {
      x402Version,
      scheme: requirementsV1.scheme,
      network: requirementsV1.network,
      payload,
    };
  }
}
