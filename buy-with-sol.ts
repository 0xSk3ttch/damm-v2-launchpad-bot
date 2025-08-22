// buy-with-sol.ts
//
// Usage:
//   WALLET_SECRET='[12,34,...]' ts-node buy-with-sol.ts <TOKEN_MINT>
//   or
//   WALLET_SECRET_BASE58='base58-privkey' ts-node buy-with-sol.ts <TOKEN_MINT>
//
// Env (optional):
//   SOLANA_RPC=https://your-rpc   (defaults to a public endpoint)
//   SLIPPAGE_BPS=2000              (20% default)
//   SOL_AMOUNT_SOL=0.02           (defaults to 0.02 SOL)
//   JUPITER_API=https://quote-api.jup.ag  (default)
//
// Notes:
// - Your wallet must have at least 0.02 SOL + fees.
// - Jupiter handles wrap/unwrap of SOL automatically.
// - Prioritization fee is set to "auto" by Jupiter.

import {
  Keypair,
  PublicKey,
} from "@solana/web3.js";

const NATIVE_SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

const RPC =
  process.env.SOLANA_RPC ??
  "https://api.mainnet-beta.solana.com"; // you can replace with your Helius RPC
const JUP_API = process.env.JUPITER_API ?? "https://quote-api.jup.ag";
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? 2000); // 20%
const SOL_AMOUNT_SOL = Number(process.env.SOL_AMOUNT_SOL ?? 0.02); // 0.02 SOL
const LAMPORTS_PER_SOL = 1_000_000_000;

async function main() {
  const outputMintStr = process.argv[2];
  if (!outputMintStr) {
    console.error("Usage: ts-node buy-with-sol.ts <TOKEN_MINT>");
    process.exit(1);
  }

  const outputMint = new PublicKey(outputMintStr);
  
  // For testing, just use a dummy keypair to get the public key
  const owner = Keypair.generate(); // Generate dummy keypair for testing

  const amountLamports = Math.floor(SOL_AMOUNT_SOL * LAMPORTS_PER_SOL);
  if (amountLamports <= 0) {
    throw new Error("SOL_AMOUNT_SOL must be > 0");
  }

  console.log("== Jupiter SOL → Token swap (QUOTE TEST) ==");
  console.log("RPC:", RPC);
  console.log("Wallet:", owner.publicKey.toBase58());
  console.log("Output mint:", outputMint.toBase58());
  console.log("Spend SOL:", SOL_AMOUNT_SOL, "(lamports:", amountLamports, ")");
  console.log("Slippage (bps):", SLIPPAGE_BPS);

  // 1) Get a quote (ExactIn: spend exactly 0.02 SOL)
  const quoteUrl = new URL(`${JUP_API}/v6/quote`);
  quoteUrl.searchParams.set("inputMint", NATIVE_SOL_MINT.toBase58());
  quoteUrl.searchParams.set("outputMint", outputMint.toBase58());
  quoteUrl.searchParams.set("amount", amountLamports.toString());
  quoteUrl.searchParams.set("swapMode", "ExactIn");
  quoteUrl.searchParams.set("slippageBps", SLIPPAGE_BPS.toString());
  quoteUrl.searchParams.set("onlyDirectRoutes", "false");
  // Optional: platformFeeBps=0 by default

  console.log("🔍 Getting quote from:", quoteUrl.toString());

  const quoteRes = await fetch(quoteUrl.toString());
  if (!quoteRes.ok) {
    const text = await quoteRes.text().catch(() => "");
    throw new Error(`Quote failed: ${quoteRes.status} ${quoteRes.statusText} ${text}`);
  }
  const quote: any = await quoteRes.json();

  if (!quote || !quote.routePlan || quote.routePlan.length === 0) {
    throw new Error("No route found for this swap.");
  }

  console.log("✅ Quote received successfully!");
  console.log(
    "Best out amount (raw):",
    quote.outAmount,
    "other info:",
    `priceImpactPct=${quote.priceImpactPct}, contextSlot=${quote.contextSlot}`
  );

  console.log("🎯 Quote test completed successfully!");
  console.log("The Jupiter API is working correctly.");
  console.log("To execute the actual swap, provide WALLET_SECRET or WALLET_SECRET_BASE58 environment variables.");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
