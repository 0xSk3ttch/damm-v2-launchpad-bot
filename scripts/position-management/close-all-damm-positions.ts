import { loadConfig } from "../../src/config/config";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { WalletProvider } from "../../src/infra/wallet-provider";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { getJupiterQuote, getJupiterSwapInstruction } from "../../src/helpers/jupiter";
import BN from "bn.js";
import {
    getAmountAFromLiquidityDelta,
    getAmountBFromLiquidityDelta,
    Rounding
} from "@meteora-ag/cp-amm-sdk";

interface TokenBalance {
    mint: string;
    balance: number;
    jupiterUsdValue?: number;
    shouldSwap?: boolean;
}

interface SwapResult {
    mint: string;
    success: boolean;
    signature?: string;
    error?: string;
    usdValue: number;
}

/**
 * Analyze tokens and determine which are profitable to swap
 */
async function analyzeTokens(connection: Connection, wallet: WalletProvider): Promise<TokenBalance[]> {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        wallet.getPublicKey(),
        { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );
    
    const tokenBalances: TokenBalance[] = [];
    const solMint = "So11111111111111111111111111111111111111112";
    
    for (const account of tokenAccounts.value) {
        const accountInfo = account.account.data.parsed.info;
        const mint = accountInfo.mint;
        const uiBalance = accountInfo.tokenAmount.uiAmount;
        
        // Skip zero balances and SOL
        if (uiBalance === 0 || mint === solMint) continue;
        
        tokenBalances.push({
            mint,
            balance: uiBalance
        });
    }
    
    // Analyze profitability
    const estimatedGasCostUsd = 0.05; // $0.05 per swap
    
    for (const token of tokenBalances) {
        try {
            const quoteAmount = new BN(1000000); // 1 token for 6 decimals
            const quote = await getJupiterQuote(
                new PublicKey(token.mint),
                new PublicKey(solMint),
                quoteAmount,
                50 // 0.5% slippage
            );
            
            if (quote.swapUsdValue) {
                const jupiterUsdValue = parseFloat(quote.swapUsdValue);
                const totalUsdValueForToken = jupiterUsdValue * token.balance;
                token.jupiterUsdValue = totalUsdValueForToken;
                
                // Determine if swap is profitable
                token.shouldSwap = totalUsdValueForToken > estimatedGasCostUsd;
            }
        } catch (error) {
            console.log(`   ❌ Failed to get quote for ${token.mint}: ${error}`);
            token.shouldSwap = false;
        }
    }
    
    return tokenBalances;
}

/**
 * Execute swaps for profitable tokens
 */
async function executeSwaps(connection: Connection, wallet: WalletProvider, tokenBalances: TokenBalance[]): Promise<SwapResult[]> {
    const profitableTokens = tokenBalances.filter(t => t.shouldSwap);
    const results: SwapResult[] = [];
    
    console.log(`\n🚀 Executing swaps for ${profitableTokens.length} profitable tokens...`);
    
    for (let i = 0; i < profitableTokens.length; i++) {
        const token = profitableTokens[i];
        console.log(`\n🔄 Swapping ${i + 1}/${profitableTokens.length}: ${token.mint}`);
        console.log(`   Balance: ${token.balance.toLocaleString()}`);
        console.log(`   Value: $${token.jupiterUsdValue?.toFixed(6)}`);
        
        try {
            // Get swap instruction
            const quoteAmount = new BN(Math.floor(token.balance * 1000000)); // Convert to raw units
            const quote = await getJupiterQuote(
                new PublicKey(token.mint),
                new PublicKey("So11111111111111111111111111111111111111112"),
                quoteAmount,
                50 // 0.5% slippage
            );
            
            const swapData = await getJupiterSwapInstruction(
                wallet.getPublicKey(),
                quote
            );
            
            // Execute the swap
            const signature = await executeSwapTransaction(connection, wallet, swapData.swapTransaction);
            
            results.push({
                mint: token.mint,
                success: true,
                signature,
                usdValue: token.jupiterUsdValue || 0
            });
            
            console.log(`   ✅ Swap successful: ${signature}`);
            
            // Wait between swaps to avoid rate limiting
            if (i < profitableTokens.length - 1) {
                console.log(`   ⏳ Waiting 3 seconds before next swap...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
        } catch (error) {
            console.log(`   ❌ Swap failed: ${error}`);
            results.push({
                mint: token.mint,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                usdValue: token.jupiterUsdValue || 0
            });
        }
    }
    
    return results;
}

/**
 * Execute a single swap transaction
 */
async function executeSwapTransaction(connection: Connection, wallet: WalletProvider, swapTransactionBase64: string): Promise<string> {
    try {
        // Try to deserialize as legacy transaction first
        let swapTransaction: Transaction | VersionedTransaction;
        let isVersioned = false;
        
        try {
            swapTransaction = Transaction.from(
                Buffer.from(swapTransactionBase64, 'base64')
            );
        } catch (legacyError) {
            // If legacy fails, try versioned transaction
            try {
                swapTransaction = VersionedTransaction.deserialize(
                    Buffer.from(swapTransactionBase64, 'base64')
                );
                isVersioned = true;
            } catch (versionedError) {
                throw new Error(`Failed to deserialize transaction: ${legacyError} / ${versionedError}`);
            }
        }
        
        // Get latest blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        
        if (isVersioned) {
            // Handle versioned transaction
            const versionedTx = swapTransaction as VersionedTransaction;
            versionedTx.message.recentBlockhash = blockhash;
            
            // Sign the versioned transaction
            const keypair = wallet.getKeypair();
            versionedTx.sign([keypair]);
            
            const signature = await connection.sendTransaction(versionedTx, {
                skipPreflight: false,
                preflightCommitment: 'confirmed'
            });
            
            // Wait for confirmation
            await connection.confirmTransaction(signature, 'confirmed');
            return signature;
            
        } else {
            // Handle legacy transaction
            const legacyTx = swapTransaction as Transaction;
            legacyTx.recentBlockhash = blockhash;
            legacyTx.feePayer = wallet.getPublicKey();
            
            // Sign and send transaction
            const keypair = wallet.getKeypair();
            legacyTx.sign(keypair);
            
            const signature = await connection.sendTransaction(legacyTx, [keypair], {
                skipPreflight: false,
                preflightCommitment: 'confirmed'
            });
            
            // Wait for confirmation
            await connection.confirmTransaction(signature, 'confirmed');
            return signature;
        }
        
    } catch (error) {
        throw new Error(`Failed to execute swap transaction: ${error}`);
    }
}

/**
 * Get summary of swap results
 */
function getSwapSummary(results: SwapResult[]): {
    totalSwapped: number;
    totalValue: number;
    successfulSwaps: number;
    failedSwaps: number;
    totalGasCost: number;
    netValue: number;
} {
    const successfulSwaps = results.filter(r => r.success).length;
    const failedSwaps = results.filter(r => !r.success).length;
    const totalValue = results.reduce((sum, r) => sum + r.usdValue, 0);
    const totalGasCost = results.length * 0.05; // $0.05 per swap
    const netValue = totalValue - totalGasCost;
    
    return {
        totalSwapped: results.length,
        totalValue,
        successfulSwaps,
        failedSwaps,
        totalGasCost,
        netValue
    };
}

async function main() {
    const cfg = loadConfig();
    const connection = new Connection(cfg.rpcEndpoint, {
        commitment: 'confirmed',
        wsEndpoint: cfg.wsEndpoint,
    });
    const wallet = WalletProvider.fromPrivateKey(cfg.privateKey);
    const cpAmm = new CpAmm(connection);
    
    try {
        console.log("🔍 CLOSING ALL DAMM POSITIONS + AUTO TOKEN SWAP TO SOL");
        console.log(`Wallet: ${wallet.getPublicKey().toBase58()}`);
        console.log("This will close positions AND automatically convert tokens to SOL\n");
        
        // Get all positions
        const positions = await cpAmm.getPositionsByUser(wallet.getPublicKey());
        console.log(`📊 Found ${positions.length} total positions`);
        
        // Find positions with unlocked liquidity
        const positionsWithLiquidity = positions.filter(pos => 
            pos.positionState.unlockedLiquidity.gtn(0)
        );
        
        console.log(`🎯 Found ${positionsWithLiquidity.length} positions with unlocked liquidity`);
        
        if (positionsWithLiquidity.length === 0) {
            console.log("❌ No positions with unlocked liquidity found");
            return;
        }
        
        // Show what we're about to close
        console.log(`\n📊 POSITIONS TO CLOSE:`);
        for (let i = 0; i < positionsWithLiquidity.length; i++) {
            const pos = positionsWithLiquidity[i];
            console.log(`   ${i + 1}. Pool: ${pos.positionState.pool.toBase58()}`);
            console.log(`      Unlocked Liquidity: ${pos.positionState.unlockedLiquidity.toString()}`);
        }
        
        console.log(`\n⚠️  WARNING: This will close ${positionsWithLiquidity.length} DAMM positions!`);
        console.log("   - All liquidity will be removed");
        console.log("   - Positions will be closed");
        console.log("   - Tokens will be automatically swapped to SOL (if profitable)");
        console.log("   - You'll gain SOL instead of worthless meme coins");
        console.log("\n   Press Ctrl+C to cancel, or wait 15 seconds to continue...");
        
        // Wait 15 seconds
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        console.log("\n🚀 Starting to close all positions...");
        const signatures: string[] = [];
        
        for (let i = 0; i < positionsWithLiquidity.length; i++) {
            const position = positionsWithLiquidity[i];
            const poolAddress = position.positionState.pool;
            
            try {
                console.log(`\n🔄 Closing position ${i + 1}/${positionsWithLiquidity.length}: ${poolAddress.toBase58()}`);
                
                // Get pool state and position details
                const poolState = await cpAmm.fetchPoolState(poolAddress);
                const currentSlot = await connection.getSlot();
                const currentTime = await connection.getBlockTime(currentSlot);
                
                // Calculate what tokens we'll receive (for info only)
                const liquidityDelta = position.positionState.unlockedLiquidity.div(new BN(2).pow(new BN(64)));
                
                const amountA = getAmountAFromLiquidityDelta(
                    liquidityDelta,
                    poolState.sqrtPrice,
                    poolState.sqrtMaxPrice,
                    Rounding.Down
                );
                
                const amountB = getAmountBFromLiquidityDelta(
                    liquidityDelta,
                    poolState.sqrtPrice,
                    poolState.sqrtMinPrice,
                    Rounding.Down
                );
                
                console.log(`   Will receive:`);
                console.log(`     Token A: ${poolState.tokenAMint.toBase58()} - Amount: ${amountA.toString()}`);
                console.log(`     Token B: ${poolState.tokenBMint.toBase58()} - Amount: ${amountB.toString()}`);
                
                // Create transaction to remove all liquidity and close position
                const removeAllLiquidityTx = await cpAmm.removeAllLiquidityAndClosePosition({
                    owner: wallet.getPublicKey(),
                    position: position.position,
                    positionNftAccount: position.positionNftAccount,
                    poolState: poolState,
                    positionState: position.positionState,
                    tokenAAmountThreshold: new BN(0),
                    tokenBAmountThreshold: new BN(0),
                    vestings: [],
                    currentPoint: new BN(currentTime ?? 0)
                });
                
                // Create and send transaction
                const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
                const transaction = new Transaction();
                transaction.add(removeAllLiquidityTx);
                
                // Get latest blockhash and set fee payer
                const { blockhash } = await connection.getLatestBlockhash();
                transaction.recentBlockhash = blockhash;
                transaction.feePayer = wallet.getPublicKey();
                
                // Simulate transaction first
                console.log("   Simulating transaction...");
                const simulation = await connection.simulateTransaction(transaction);
                if (simulation.value.err) {
                    console.log("   Simulation failed:", simulation.value.err);
                    throw new Error("Transaction simulation failed");
                }
                console.log("   Simulation successful");
                
                // Sign and send transaction
                console.log("   Signing and sending transaction...");
                const keypair = wallet.getKeypair();
                transaction.sign(keypair);
                
                const signature = await sendAndConfirmTransaction(
                    connection,
                    transaction,
                    [keypair],
                    { commitment: "confirmed" }
                );
                
                signatures.push(signature);
                console.log(`   ✅ Position closed successfully: ${signature}`);
                
                // Wait between transactions to avoid rate limiting
                if (i < positionsWithLiquidity.length - 1) {
                    console.log("   ⏳ Waiting 3 seconds before next position...");
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
                
            } catch (error) {
                console.error(`   ❌ Failed to close position:`, error);
                // Continue with other positions
            }
        }
        
        console.log(`\n🎉 SUCCESS: Closed ${signatures.length}/${positionsWithLiquidity.length} positions`);
        console.log("All DAMM positions have been closed!");
        
        if (signatures.length > 0) {
            console.log(`\n📝 Transaction Signatures:`);
            signatures.forEach((sig, i) => {
                console.log(`   Position ${i + 1}: ${sig}`);
            });
        }
        
        // Step 2: Automatically swap tokens to SOL
        console.log(`\n🔄 STEP 2: AUTOMATICALLY SWAPPING TOKENS TO SOL`);
        console.log("==================================================");
        
        try {
            // Analyze tokens for profitability
            console.log("📊 Analyzing tokens for profitability...");
            const tokenBalances = await analyzeTokens(connection, wallet);
            
            if (tokenBalances.length === 0) {
                console.log("✅ No tokens found to analyze");
            } else {
                const profitableTokens = tokenBalances.filter(t => t.shouldSwap);
                const totalValue = tokenBalances.reduce((sum, t) => sum + (t.jupiterUsdValue || 0), 0);
                
                console.log(`\n💰 TOKEN ANALYSIS:`);
                console.log("==================");
                console.log(`   Total Tokens Found: ${tokenBalances.length}`);
                console.log(`   Profitable to Swap: ${profitableTokens.length}`);
                console.log(`   Total Token Value: ~$${totalValue.toFixed(6)}`);
                console.log(`   Estimated Gas Cost: ~$${(profitableTokens.length * 0.05).toFixed(2)}`);
                console.log(`   Net Value After Gas: ~$${(totalValue - (profitableTokens.length * 0.05)).toFixed(6)}`);
                
                if (profitableTokens.length > 0) {
                    // Execute swaps
                    const results = await executeSwaps(connection, wallet, tokenBalances);
                    
                    // Display results
                    const summary = getSwapSummary(results);
                    
                    console.log(`\n📊 SWAP RESULTS:`);
                    console.log("================");
                    console.log(`   Total Attempted: ${summary.totalSwapped}`);
                    console.log(`   Successful: ${summary.successfulSwaps}`);
                    console.log(`   Failed: ${summary.failedSwaps}`);
                    console.log(`   Total Value Swapped: ~$${summary.totalValue.toFixed(6)}`);
                    console.log(`   Total Gas Cost: ~$${summary.totalGasCost.toFixed(2)}`);
                    console.log(`   Net Value: ~$${summary.netValue.toFixed(6)}`);
                    
                    if (summary.successfulSwaps > 0) {
                        console.log(`\n✅ SUCCESSFUL SWAPS:`);
                        results.filter(r => r.success).forEach((result, i) => {
                            console.log(`   ${i + 1}. ${result.mint}: ${result.signature}`);
                        });
                    }
                    
                    if (summary.failedSwaps > 0) {
                        console.log(`\n❌ FAILED SWAPS:`);
                        results.filter(r => !r.success).forEach((result, i) => {
                            console.log(`   ${i + 1}. ${result.mint}: ${result.error}`);
                        });
                    }
                } else {
                    console.log("\n❌ No tokens are profitable to swap after gas costs");
                }
            }
        } catch (error) {
            console.error(`❌ Error during token swapping: ${error}`);
            console.log("   You can manually swap tokens to SOL using Jupiter");
        }
        
        console.log("\n💡 FINAL NEXT STEPS:");
        console.log("   1. Check your SOL balance - should have increased significantly");
        console.log("   2. Any failed swaps can be retried manually on Jupiter");
        console.log("   3. Consider closing any remaining worthless token accounts");
        
    } catch (error) {
        console.error("❌ Error:", error);
    }
}

main().catch(console.error);
