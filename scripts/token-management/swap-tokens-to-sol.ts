import { loadConfig } from "../../src/config/config";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { WalletProvider } from "../../src/infra/wallet-provider";
import { getJupiterQuote, getJupiterSwapInstruction } from "../../src/helpers/jupiter";
import BN from "bn.js";

interface TokenBalance {
    mint: string;
    balance: number;
    jupiterUsdValue?: number;
    shouldSwap?: boolean;
    swapTransaction?: string;
}

interface SwapResult {
    mint: string;
    success: boolean;
    signature?: string;
    error?: string;
    usdValue: number;
}

export class TokenSwapper {
    private connection: Connection;
    private wallet: WalletProvider;
    private solMint = "So11111111111111111111111111111111111111112";
    
    constructor(connection: Connection, wallet: WalletProvider) {
        this.connection = connection;
        this.wallet = wallet;
    }
    
    /**
     * Analyze tokens and determine which are profitable to swap
     */
    async analyzeTokens(): Promise<TokenBalance[]> {
        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
            this.wallet.getPublicKey(),
            { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
        );
        
        const tokenBalances: TokenBalance[] = [];
        
        for (const account of tokenAccounts.value) {
            const accountInfo = account.account.data.parsed.info;
            const mint = accountInfo.mint;
            const uiBalance = accountInfo.tokenAmount.uiAmount;
            
            // Skip zero balances and SOL
            if (uiBalance === 0 || mint === this.solMint) continue;
            
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
                    new PublicKey(this.solMint),
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
    async executeSwaps(tokenBalances: TokenBalance[]): Promise<SwapResult[]> {
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
                    new PublicKey(this.solMint),
                    quoteAmount,
                    50 // 0.5% slippage
                );
                
                const swapData = await getJupiterSwapInstruction(
                    this.wallet.getPublicKey(),
                    quote
                );
                
                // Execute the swap
                const signature = await this.executeSwapTransaction(swapData.swapTransaction);
                
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
    private async executeSwapTransaction(swapTransactionBase64: string): Promise<string> {
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
            const { blockhash } = await this.connection.getLatestBlockhash();
            
            if (isVersioned) {
                // Handle versioned transaction
                const versionedTx = swapTransaction as VersionedTransaction;
                versionedTx.message.recentBlockhash = blockhash;
                
                // Sign the versioned transaction
                const keypair = this.wallet.getKeypair();
                versionedTx.sign([keypair]);
                
                const signature = await this.connection.sendTransaction(versionedTx, {
                    skipPreflight: false,
                    preflightCommitment: 'confirmed'
                });
                
                // Wait for confirmation
                await this.connection.confirmTransaction(signature, 'confirmed');
                return signature;
                
            } else {
                // Handle legacy transaction
                const legacyTx = swapTransaction as Transaction;
                legacyTx.recentBlockhash = blockhash;
                legacyTx.feePayer = this.wallet.getPublicKey();
                
                // Sign and send transaction
                const keypair = this.wallet.getKeypair();
                legacyTx.sign(keypair);
                
                const signature = await this.connection.sendTransaction(legacyTx, [keypair], {
                    skipPreflight: false,
                    preflightCommitment: 'confirmed'
                });
                
                // Wait for confirmation
                await this.connection.confirmTransaction(signature, 'confirmed');
                return signature;
            }
            
        } catch (error) {
            throw new Error(`Failed to execute swap transaction: ${error}`);
        }
    }
    
    /**
     * Get summary of swap results
     */
    getSwapSummary(results: SwapResult[]): {
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
}

async function main() {
    const cfg = loadConfig();
    const connection = new Connection(cfg.rpcEndpoint, {
        commitment: 'confirmed',
        wsEndpoint: cfg.wsEndpoint,
    });
    const wallet = WalletProvider.fromPrivateKey(cfg.privateKey);
    
    try {
        console.log("🔄 SMART TOKEN SWAP TO SOL");
        console.log(`Wallet: ${wallet.getPublicKey().toBase58()}`);
        console.log("This will swap tokens to SOL only if profitable (worth more than gas costs)\n");
        
        const swapper = new TokenSwapper(connection, wallet);
        
        // Step 1: Analyze tokens
        console.log("📊 Analyzing tokens for profitability...");
        const tokenBalances = await swapper.analyzeTokens();
        
        if (tokenBalances.length === 0) {
            console.log("✅ No tokens found to analyze");
            return;
        }
        
        // Display analysis
        console.log(`\n💰 TOKEN ANALYSIS:`);
        console.log("==================");
        
        const profitableTokens = tokenBalances.filter(t => t.shouldSwap);
        const totalValue = tokenBalances.reduce((sum, t) => sum + (t.jupiterUsdValue || 0), 0);
        
        console.log(`   Total Tokens Found: ${tokenBalances.length}`);
        console.log(`   Profitable to Swap: ${profitableTokens.length}`);
        console.log(`   Total Token Value: ~$${totalValue.toFixed(6)}`);
        console.log(`   Estimated Gas Cost: ~$${(profitableTokens.length * 0.05).toFixed(2)}`);
        console.log(`   Net Value After Gas: ~$${(totalValue - (profitableTokens.length * 0.05)).toFixed(6)}`);
        
        // Show individual token analysis
        console.log(`\n🪙 TOKEN BREAKDOWN:`);
        for (let i = 0; i < tokenBalances.length; i++) {
            const token = tokenBalances[i];
            const status = token.shouldSwap ? "✅ WORTH SWAPPING" : "❌ NOT WORTH IT";
            console.log(`   ${i + 1}. ${token.mint}`);
            console.log(`      Balance: ${token.balance.toLocaleString()}`);
            console.log(`      Value: $${token.jupiterUsdValue?.toFixed(6) || 'Unknown'}`);
            console.log(`      Status: ${status}`);
        }
        
        if (profitableTokens.length === 0) {
            console.log("\n❌ No tokens are profitable to swap after gas costs");
            return;
        }
        
        // Step 2: Execute swaps
        console.log(`\n🚀 READY TO SWAP ${profitableTokens.length} PROFITABLE TOKENS TO SOL!`);
        console.log(`   Press Ctrl+C to cancel, or wait 10 seconds to continue...`);
        
        // Wait 10 seconds
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        const results = await swapper.executeSwaps(tokenBalances);
        
        // Step 3: Display results
        const summary = swapper.getSwapSummary(results);
        
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
        
        console.log(`\n💡 NEXT STEPS:`);
        console.log(`   1. Check your SOL balance - should have increased`);
        console.log(`   2. Failed swaps can be retried manually on Jupiter`);
        console.log(`   3. Consider closing any remaining worthless token accounts`);
        
    } catch (error) {
        console.error("❌ Error:", error);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
