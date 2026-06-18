import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { AccountAddress } from "@concordium/web-sdk";

const ADDRESS = process.argv[2] || "381h88FbHED8W2ofENoa5bWD1ri5tXmbwp9PqJptvqj1qJUDo3";

/** Helper script to fetch token info from Concordium testnet account. */
async function main() {
  const creds = credentials.createSsl();
  const client = new ConcordiumGRPCNodeClient("grpc.testnet.concordium.com", 20000, creds);
  const account = AccountAddress.fromBase58(ADDRESS);

  const info = await client.getAccountInfo(account);
  console.log("Account:", ADDRESS);
  console.log("CCD balance:", info.accountAmount?.toString());

  if (info.accountTokens && Array.isArray(info.accountTokens)) {
    console.log("\nTokens:", info.accountTokens.length);
    for (const token of info.accountTokens) {
      console.log("  Raw keys:", Object.keys(token));
      console.log(
        "  JSON:",
        JSON.stringify(
          token,
          (key, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        ),
      );
      console.log("  ---");
    }
  } else {
    console.log("\nNo tokens on this account");
  }
}

main().catch(err => console.error("Error:", err.message || err));
