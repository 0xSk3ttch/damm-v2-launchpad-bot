import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface JupiterQuoteResponse {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: {
    feeBps: number;
    feeAccounts: Record<string, string>;
  };
  priceImpactPct: string;
  swapUsdValue?: string; // USD value of the swap
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot: number;
  timeTaken: number;
}

export interface JupiterSwapInstructionResponse {
  swapTransaction: string;
}

export async function getJupiterQuote(
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: BN,
  slippageBps: number = 50,
  platformFeeBps: number = 0,
  onlyDirectRoutes: boolean = false,
  asLegacyTransaction: boolean = true,
  useSharedAccounts: boolean = true,
  jupiterApiUrl: string = "https://quote-api.jup.ag/v6"
): Promise<JupiterQuoteResponse> {
  const quoteUrl = new URL(`${jupiterApiUrl}/quote`);
  
  quoteUrl.searchParams.set("inputMint", inputMint.toBase58());
  quoteUrl.searchParams.set("outputMint", outputMint.toBase58());
  quoteUrl.searchParams.set("amount", amount.toString());
  quoteUrl.searchParams.set("swapMode", "ExactIn");
  quoteUrl.searchParams.set("slippageBps", slippageBps.toString());
  quoteUrl.searchParams.set("onlyDirectRoutes", onlyDirectRoutes.toString());
  quoteUrl.searchParams.set("asLegacyTransaction", asLegacyTransaction.toString());
  quoteUrl.searchParams.set("useSharedAccounts", useSharedAccounts.toString());
  
  if (platformFeeBps > 0) {
    quoteUrl.searchParams.set("platformFeeBps", platformFeeBps.toString());
  }

  console.log(`Getting Jupiter quote from: ${quoteUrl.toString()}`);

  const response = await fetch(quoteUrl.toString());
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Jupiter quote API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const quote = await response.json();
  
  if (!quote || !quote.routePlan || quote.routePlan.length === 0) {
    throw new Error("No route found for this swap");
  }

  console.log(`Jupiter quote received: ${quote.outAmount} out for ${quote.inAmount} in`);
  return quote;
}

export async function getJupiterSwapInstruction(
  userPublicKey: PublicKey,
  quote: JupiterQuoteResponse,
  jupiterApiUrl: string = "https://quote-api.jup.ag/v6"
): Promise<JupiterSwapInstructionResponse> {
  const swapUrl = `${jupiterApiUrl}/swap`;
  
  const swapRequest = {
    quoteResponse: quote,
    userPublicKey: userPublicKey.toBase58(),
    wrapAndUnwrapSol: true,
    prioritizationFeeLamports: 50000, // 0.00005 SOL priority fee
    asLegacyTransaction: false, // Request versioned transaction
  };

  console.log(`Getting swap instructions from: ${swapUrl}`);

  const response = await fetch(swapUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(swapRequest),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Jupiter swap API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const swapData = await response.json();
  
  if (!swapData || !swapData.swapTransaction) {
    throw new Error("Failed to get swap instructions from Jupiter");
  }

  console.log(`Jupiter swap instructions received`);
  return swapData;
}

