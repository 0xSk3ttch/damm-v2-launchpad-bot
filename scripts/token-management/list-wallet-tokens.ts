import { loadConfig } from "../../src/config/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { WalletProvider } from "../../src/infra/wallet-provider";
import BN from "bn.js";

interface TokenBalance {
    mint: string;
    symbol?: string;
    name?: string;
    balance: BN;
    decimals: number;
    uiBalance: number;
    estimatedSolValue?: number;
    estimatedUsdValue?: number;
    jupiterUsdValue?: number;
}

async function main() {
    const cfg = loadConfig();
    const connection = new Connection(cfg.rpcEndpoint, {
        commitment: 'confirmed',
        wsEndpoint: cfg.wsEndpoint,
    });
    const wallet = WalletProvider.fromPrivateKey(cfg.privateKey);
    
    try {
        console.log("🔍 LISTING ALL TOKENS IN WALLET");
        console.log(`Wallet: ${wallet.getPublicKey().toBase58()}`);
        console.log("This will show all tokens and their balances\n");
        
        // Get all token accounts
        console.log("📊 Fetching token accounts...");
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
            wallet.getPublicKey(),
            { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
        );
        
        console.log(`Found ${tokenAccounts.value.length} token accounts\n`);
        
        if (tokenAccounts.value.length === 0) {
            console.log("❌ No token accounts found");
            return;
        }
        
        // Process token accounts
        const tokenBalances: TokenBalance[] = [];
        const solMint = "So11111111111111111111111111111111111111112";
        
        for (const account of tokenAccounts.value) {
            const accountInfo = account.account.data.parsed.info;
            const mint = accountInfo.mint;
            const balance = new BN(accountInfo.tokenAmount.amount);
            const decimals = accountInfo.tokenAmount.decimals;
            const uiBalance = accountInfo.tokenAmount.uiAmount;
            
            // Skip zero balances
            if (balance.isZero()) continue;
            
            // Skip SOL (wrapped SOL) as we'll handle native SOL separately
            if (mint === solMint) continue;
            
            tokenBalances.push({
                mint,
                symbol: accountInfo.tokenAmount.symbol,
                name: accountInfo.tokenAmount.name,
                balance,
                decimals,
                uiBalance: uiBalance || 0
            });
        }
        
        // Get native SOL balance
        const solBalance = await connection.getBalance(wallet.getPublicKey());
        
        console.log("💰 TOKEN BALANCES:");
        console.log("==================");
        
        // Show SOL first
        console.log(`\n🟣 SOL (Native):`);
        console.log(`   Balance: ${(solBalance / 1e9).toFixed(9)} SOL`);
        console.log(`   Value: ~${(solBalance / 1e9).toFixed(9)} SOL`);
        
        // Show other tokens
        if (tokenBalances.length > 0) {
            console.log(`\n🪙 Other Tokens (${tokenBalances.length}):`);
            
            // Sort by balance value (rough estimate)
            tokenBalances.sort((a, b) => {
                const aValue = a.uiBalance * Math.pow(10, a.decimals);
                const bValue = b.uiBalance * Math.pow(10, b.decimals);
                return bValue - aValue;
            });
            
            for (let i = 0; i < tokenBalances.length; i++) {
                const token = tokenBalances[i];
                console.log(`\n   ${i + 1}. ${token.symbol || 'Unknown'} (${token.mint})`);
                console.log(`      Name: ${token.name || 'Unknown'}`);
                console.log(`      Balance: ${token.uiBalance.toLocaleString()}`);
                console.log(`      Raw Balance: ${token.balance.toString()}`);
                console.log(`      Decimals: ${token.decimals}`);
                
                // Try to get Jupiter quote for SOL value estimation
                try {
                    // Use larger amounts for quotes to avoid "amount too small" errors
                    // Start with 1M units (1 token for 6 decimals), then try 10M if that fails
                    let quoteAmount = new BN(1000000); // 1 token for 6 decimals
                    let quoteResponse = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${token.mint}&outputMint=${solMint}&amount=${quoteAmount.toString()}&slippageBps=50`);
                    
                    // If first attempt fails, try with 10M units
                    if (!quoteResponse.ok) {
                        quoteAmount = new BN(10000000); // 10 tokens for 6 decimals
                        quoteResponse = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${token.mint}&outputMint=${solMint}&amount=${quoteAmount.toString()}&slippageBps=50`);
                    }
                    
                    if (quoteResponse.ok) {
                        const quote = await quoteResponse.json();
                        const outAmount = new BN(quote.outAmount);
                        const outAmountSol = outAmount.toNumber() / 1e9;
                        
                        // Scale up to actual balance
                        const estimatedSolValue = (outAmountSol / quoteAmount.toNumber()) * token.uiBalance;
                        
                        console.log(`      Estimated SOL Value: ~${estimatedSolValue.toFixed(6)} SOL`);
                        token.estimatedSolValue = estimatedSolValue;
                        
                        // Get USD value from Jupiter if available
                        if (quote.swapUsdValue) {
                            const jupiterUsdValue = parseFloat(quote.swapUsdValue);
                            // Scale up to actual balance
                            const totalJupiterUsdValue = (jupiterUsdValue / quoteAmount.toNumber()) * token.uiBalance;
                            token.jupiterUsdValue = totalJupiterUsdValue;
                            
                            // Format small values properly
                            if (totalJupiterUsdValue < 0.01) {
                                console.log(`      Jupiter USD Value: ~$${totalJupiterUsdValue.toFixed(6)}`);
                            } else if (totalJupiterUsdValue < 1) {
                                console.log(`      Jupiter USD Value: ~$${totalJupiterUsdValue.toFixed(4)}`);
                            } else {
                                console.log(`      Jupiter USD Value: ~$${totalJupiterUsdValue.toFixed(2)}`);
                            }
                        } else {
                            console.log(`      Jupiter USD Value: No USD value in quote`);
                        }
                    } else {
                        const errorText = await quoteResponse.text().catch(() => "");
                        if (quoteResponse.status === 400 && errorText.includes("Could not find any route")) {
                            console.log(`      Jupiter Quote: No trading route found for this token`);
                        } else {
                            console.log(`      Jupiter Quote: Failed - ${quoteResponse.status}: ${errorText}`);
                        }
                    }
                } catch (error) {
                    console.log(`      Jupiter Quote: Error: ${error}`);
                }
                
                // Try to get token metadata for better names
                try {
                    const mintPubkey = new PublicKey(token.mint);
                    const tokenMetadata = await connection.getParsedAccountInfo(mintPubkey);
                    
                    if (tokenMetadata.value && tokenMetadata.value.data) {
                        const data = tokenMetadata.value.data as any;
                        if (data.parsed && data.parsed.info) {
                            const info = data.parsed.info;
                            if (info.symbol && info.symbol !== 'Unknown') {
                                token.symbol = info.symbol;
                                console.log(`      Symbol: ${info.symbol}`);
                            }
                            if (info.name && info.name !== 'Unknown') {
                                token.name = info.name;
                                console.log(`      Name: ${info.name}`);
                            }
                        }
                    }
                } catch (error) {
                    // Ignore metadata errors
                }
                
                // Estimate USD value based on user's clarification (30-75 cents TOTAL for all tokens)
                // This is a placeholder - we'll use Jupiter's actual values when available
                if (!token.jupiterUsdValue) {
                    console.log(`      Estimated USD Value: Unknown (Jupiter quote failed)`);
                }
            }
            
                    // Summary
        console.log(`\n📊 SUMMARY:`);
        console.log(`   Native SOL: ${(solBalance / 1e9).toFixed(9)} SOL`);
        console.log(`   Other Tokens: ${tokenBalances.length} different tokens`);
        
        // Calculate total estimated value from Jupiter
        const totalJupiterUsd = tokenBalances
            .filter(t => t.jupiterUsdValue !== undefined)
            .reduce((sum, t) => sum + (t.jupiterUsdValue || 0), 0);
        
        const totalEstimatedSol = tokenBalances
            .filter(t => t.estimatedSolValue !== undefined)
            .reduce((sum, t) => sum + (t.estimatedSolValue || 0), 0);
        
        if (totalJupiterUsd > 0) {
            console.log(`   Total Jupiter USD Value: ~$${totalJupiterUsd.toFixed(4)} (tokens only)`);
        }
        
        if (totalEstimatedSol > 0) {
            console.log(`   Total Estimated SOL Value: ~${(solBalance / 1e9 + totalEstimatedSol).toFixed(6)} SOL`);
        }
        
        // Show user's clarification about total value
        console.log(`   User Note: Total token value should be between $0.30-$0.75 TOTAL (not per token)`);
        
        console.log(`\n💡 NEXT STEPS:`);
        console.log(`   1. Review the tokens above - Jupiter quotes show actual market values`);
        console.log(`   2. Consider swapping valuable tokens to SOL or keeping them`);
        console.log(`   3. Use Jupiter or other DEX to convert tokens to SOL if desired`);
        if (totalJupiterUsd > 0) {
            console.log(`   4. Total Jupiter USD value: ~$${totalJupiterUsd.toFixed(4)}`);
        }
        
    } else {
        console.log("\n✅ No other tokens found - only native SOL");
    }
        
    } catch (error) {
        console.error("❌ Error:", error);
    }
}

main().catch(console.error);
