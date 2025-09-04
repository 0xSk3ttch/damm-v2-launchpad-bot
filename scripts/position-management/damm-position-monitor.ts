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

interface PositionInfo {
    poolAddress: PublicKey;
    position: PublicKey;
    positionNftAccount: PublicKey;
    unlockedLiquidity: BN;
    tokenAMint: PublicKey;
    tokenBMint: PublicKey;
    tokenAFlag: number;
    tokenBFlag: number;
    creationTime?: number;
    actualPosition: any; // Store the actual position object from SDK
}

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

interface PositionCloseResult {
    position: string;
    success: boolean;
    signature?: string;
    error?: string;
    tokensReceived: { mint: string; amount: string }[];
}

export class DammPositionMonitor {
    private connection: Connection;
    private wallet: WalletProvider;
    private cpAmm: CpAmm;
    private discordWebhookUrl: string;
    private checkInterval: number = 60000; // Check every 1 minute
    private positionLifetime: number = 30 * 60 * 1000; // 30 minutes in milliseconds
    private isRunning: boolean = false;
    private knownPositions: Set<string> = new Set();
    private positionCreationTimes: Map<string, number> = new Map();
    
    // List of positions to exclude (testing positions and problematic dust positions)
    private excludedPositions: Set<string> = new Set([
        // These are the 11 testing positions that should not be processed
        "FYtzRxGi65vxcGVMHPZ9BNoNJw59mvgcK2cCYwbTSw6n",
        "4coPScEwkXbxK3YB62DQSZPA2UdRHKcGQdiopPKNiYk2",
        "CgK631Qt9AUTNMeNAUtc83FSXRXhT7s2zj7Kj1pump",
        "CmZiLVhmyoMWKUFsqWH4kbydyjgzGgbUj68R8sR42mwC",
        "H5QJfXdnucU2iVohBQoNn1FnvUe5yMGEEn24dWM1pump",
        "Fr8hNczFGnNVXS289wt16XXcC9awTvXVi4Db9qk8pump",
        "B1HhJXQ1TJQjwseJ2iRzGJxz9RNWtoYD3ToZCjRedH98",
        "CASTv31x5MKPvQZjqG1HMyHJwCjQoDPsL9FqEisfpump",
        "ApyuAVax9DmTKHhF2MZCbHAkUSfEZQocg5VT7vpBpump",
        "HXvgUc3qzP2AUTNMeNAUtc83FSXRXhT7s2zj7Kj1pump",
        "5WCMZNNCGJCZd8GCL3ZDwBjEpLxFQnws6p1tz1kztRSi",
        
        // These are the 9 problematic dust positions that keep failing
        "33HGiCYsH8RuGptaktkKsLWynSdsWoVgNa4JetqfsaxE",
        "A6EdKL8RRiYs2q2KgngZwo4ygt9m94kGi6RMNZLXFSi9",
        "8sihAK9SrgV3rCVypMhKSXv9PLbZRe51bnemMZUsrjyK",
        "VStyJ8W4sXDLk1EAcWySusQSMFX2x4WNAvRxKYvEzZu",
        "BDu8JcddysjQ7YRUkVkgWBJ4FpBbNKPpKnp65woC2CyS",
        "GBChMFpSsVuyMA5ksiXPJ1paHYc38RDo1LdfoC1axriE",
        "7RL4gBmGQP2i5WGMhjWTAibeHrQiYGm2AriJBuBstXYW",
        
        // These are 2 more dust positions found during testing
        "AP8NwAFMejgaNk5P86xw4kHBhmxg7Cy3GxuME6GgH1Qm",
        "EtgEi6hdB8squoa1AXQrKV2yMAWHWPGMCYkAwpiUCsYP"
    ]);
    
    constructor(connection: Connection, wallet: WalletProvider, discordWebhookUrl: string) {
        this.connection = connection;
        this.wallet = wallet;
        this.cpAmm = new CpAmm(connection);
        this.discordWebhookUrl = discordWebhookUrl;
    }
    
    /**
     * Start monitoring DAMM positions
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log("⚠️  Monitor is already running");
            return;
        }
        
        console.log("🚀 Starting DAMM Position Monitor");
        console.log(`   Wallet: ${this.wallet.getPublicKey().toBase58()}`);
        console.log(`   Check Interval: ${this.checkInterval / 1000} seconds`);
        console.log(`   Position Lifetime: ${this.positionLifetime / 1000 / 60} minutes`);
        console.log(`   Auto-close + Auto-swap to SOL enabled\n`);
        
        this.isRunning = true;
        
        // Initial scan to establish baseline
        await this.scanPositions();
        
        // Start monitoring loop
        this.monitorLoop();
    }
    
    /**
     * Stop monitoring
     */
    stop(): void {
        this.isRunning = false;
        console.log("🛑 DAMM Position Monitor stopped");
    }
    
    /**
     * Main monitoring loop
     */
    private async monitorLoop(): Promise<void> {
        while (this.isRunning) {
            try {
                await this.checkAndProcessPositions();
                await this.sleep(this.checkInterval);
            } catch (error) {
                console.error(`❌ Error in monitoring loop: ${error}`);
                await this.sleep(10000); // Wait 10 seconds on error
            }
        }
    }
    
    /**
     * Check for positions that need processing
     */
    private async checkAndProcessPositions(): Promise<void> {
        const positions = await this.cpAmm.getPositionsByUser(this.wallet.getPublicKey());
        const currentTime = Date.now();
        
        // Process new positions
        for (const position of positions) {
            const positionKey = position.position.toBase58();
            
            if (!this.knownPositions.has(positionKey)) {
                // New position found
                this.knownPositions.add(positionKey);
                this.positionCreationTimes.set(positionKey, currentTime);
                console.log(`🆕 New position detected: ${positionKey}`);
                console.log(`   Pool: ${position.positionState.pool.toBase58()}`);
                console.log(`   Unlocked Liquidity: ${position.positionState.unlockedLiquidity.toString()}`);
                console.log(`   ⏰ Will auto-close in 30 minutes\n`);
            }
        }
        
        // Check for positions ready to close
        const positionsToClose: PositionInfo[] = [];
        
        for (const [positionKey, creationTime] of this.positionCreationTimes) {
            // Skip excluded testing positions
            if (this.excludedPositions.has(positionKey)) {
                continue;
            }
            
            const age = currentTime - creationTime;
            
            if (age >= this.positionLifetime) {
                const position = positions.find(p => p.position.toBase58() === positionKey);
                if (position && position.positionState.unlockedLiquidity.gtn(0)) {
                    // Calculate expected token amounts to filter out dust positions
                    try {
                        const poolState = await this.cpAmm.fetchPoolState(position.positionState.pool);
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
                        
                        // Skip positions that would return 0 tokens (dust positions)
                        if (amountA.isZero() && amountB.isZero()) {
                            console.log(`   🗑️  Skipping dust position ${positionKey} (0 tokens expected)`);
                            // Remove from tracking since it's worthless
                            this.knownPositions.delete(positionKey);
                            this.positionCreationTimes.delete(positionKey);
                            continue;
                        }
                        
                        positionsToClose.push({
                            poolAddress: position.positionState.pool,
                            position: position.position,
                            positionNftAccount: position.positionNftAccount,
                            unlockedLiquidity: position.positionState.unlockedLiquidity,
                            tokenAMint: new PublicKey("11111111111111111111111111111111"), // Will get from pool state
                            tokenBMint: new PublicKey("11111111111111111111111111111111"), // Will get from pool state
                            tokenAFlag: 0, // Will get from pool state
                            tokenBFlag: 0, // Will get from pool state
                            creationTime: creationTime,
                            actualPosition: position // Store the actual position object
                        });
                        
                    } catch (error) {
                        console.log(`   ❌ Error calculating tokens for position ${positionKey}: ${error}`);
                        continue;
                    }
                }
            }
        }
        
        if (positionsToClose.length > 0) {
            console.log(`\n⏰ Found ${positionsToClose.length} position(s) ready for auto-close (30+ minutes old)`);
            await this.processPositions(positionsToClose);
        }
    }
    
    /**
     * Process positions that need to be closed
     */
    private async processPositions(positions: PositionInfo[]): Promise<void> {
        const results: PositionCloseResult[] = [];
        
        for (let i = 0; i < positions.length; i++) {
            const position = positions[i];
            console.log(`\n🔄 Auto-closing position ${i + 1}/${positions.length}: ${position.position.toBase58()}`);
            
            try {
                const result = await this.closePosition(position);
                results.push(result);
                
                if (result.success) {
                    console.log(`   ✅ Position closed successfully: ${result.signature}`);
                    
                    // Send Discord notification for successful position close
                    try {
                        await this.sendPositionClosedNotification(result, position);
                    } catch (error) {
                        console.error(`   ❌ Discord notification failed: ${error}`);
                    }
                    
                    // Remove from tracking
                    this.knownPositions.delete(position.position.toBase58());
                    this.positionCreationTimes.delete(position.position.toBase58());
                } else {
                    console.log(`   ❌ Position close failed: ${result.error}`);
                }
                
                // Wait between positions
                if (i < positions.length - 1) {
                    console.log("   ⏳ Waiting 3 seconds before next position...");
                    await this.sleep(3000);
                }
                
            } catch (error) {
                console.error(`   ❌ Error processing position: ${error}`);
                results.push({
                    position: position.position.toBase58(),
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    tokensReceived: []
                });
            }
        }
        
        // Summary
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        console.log(`\n📊 AUTO-CLOSE RESULTS:`);
        console.log(`   Successful: ${successful}`);
        console.log(`   Failed: ${failed}`);
        
        if (successful > 0) {
            console.log(`\n🔄 STEP 2: AUTO-SWAPPING TOKENS TO SOL`);
            console.log("==========================================");
            await this.swapTokensToSol();
        }
    }
    
    /**
     * Close a single position
     */
    private async closePosition(position: PositionInfo): Promise<PositionCloseResult> {
        try {
            // Get pool state
            const poolState = await this.cpAmm.fetchPoolState(position.poolAddress);
            const currentSlot = await this.connection.getSlot();
            const currentTime = await this.connection.getBlockTime(currentSlot);
            
            // Calculate what tokens we'll receive
            const liquidityDelta = position.unlockedLiquidity.div(new BN(2).pow(new BN(64)));
            
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
            const removeAllLiquidityTx = await this.cpAmm.removeAllLiquidityAndClosePosition({
                owner: this.wallet.getPublicKey(),
                position: position.position,
                positionNftAccount: position.positionNftAccount,
                poolState: poolState,
                positionState: position.actualPosition.positionState, // Use the actual position state from the SDK
                tokenAAmountThreshold: new BN(0),
                tokenBAmountThreshold: new BN(0),
                vestings: [],
                currentPoint: new BN(currentTime ?? 0)
            });
            
            // Create and send transaction
            const transaction = new Transaction();
            transaction.add(removeAllLiquidityTx);
            
            // Get latest blockhash and set fee payer
            const { blockhash } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.wallet.getPublicKey();
            
            // Simulate transaction first
            console.log("   Simulating transaction...");
            const simulation = await this.connection.simulateTransaction(transaction);
            if (simulation.value.err) {
                console.log("   Simulation failed:", simulation.value.err);
                throw new Error("Transaction simulation failed");
            }
            console.log("   Simulation successful");
            
            // Sign and send transaction
            console.log("   Signing and sending transaction...");
            const keypair = this.wallet.getKeypair();
            transaction.sign(keypair);
            
            const { sendAndConfirmTransaction } = await import("@solana/web3.js");
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [keypair],
                { commitment: "confirmed" }
            );
            
            return {
                position: position.position.toBase58(),
                success: true,
                signature,
                tokensReceived: [
                    { mint: poolState.tokenAMint.toBase58(), amount: amountA.toString() },
                    { mint: poolState.tokenBMint.toBase58(), amount: amountB.toString() }
                ]
            };
            
        } catch (error) {
            return {
                position: position.position.toBase58(),
                success: false,
                error: error instanceof Error ? error.message : String(error),
                tokensReceived: []
            };
        }
    }
    
    /**
     * Analyze tokens and determine which are profitable to swap
     */
    private async analyzeTokens(): Promise<TokenBalance[]> {
        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
            this.wallet.getPublicKey(),
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
    private async executeSwaps(tokenBalances: TokenBalance[]): Promise<SwapResult[]> {
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
                
                // Send Discord notification for successful swap
                try {
                    await this.sendSwapNotification({
                        mint: token.mint,
                        success: true,
                        signature,
                        usdValue: token.jupiterUsdValue || 0
                    }, token);
                } catch (error) {
                    console.error(`   ❌ Discord swap notification failed: ${error}`);
                }
                
                // Wait between swaps to avoid rate limiting
                if (i < profitableTokens.length - 1) {
                    console.log(`   ⏳ Waiting 3 seconds before next swap...`);
                    await this.sleep(3000);
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
    private getSwapSummary(results: SwapResult[]): {
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
    
    /**
     * Main token swap workflow
     */
    private async swapTokensToSol(): Promise<void> {
        try {
            // Analyze tokens for profitability
            console.log("📊 Analyzing tokens for profitability...");
            const tokenBalances = await this.analyzeTokens();
            
            if (tokenBalances.length === 0) {
                console.log("✅ No tokens found to analyze");
                return;
            }
            
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
                const results = await this.executeSwaps(tokenBalances);
                
                // Display results
                const summary = this.getSwapSummary(results);
                
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
            
        } catch (error) {
            console.error(`❌ Error during token swapping: ${error}`);
        }
    }
    
    /**
     * Initial scan to establish baseline of existing positions
     */
    private async scanPositions(): Promise<void> {
        console.log("🔍 Performing initial position scan...");
        console.log("   Since you only have SOL and USDC, ignoring all existing positions");
        console.log("   Monitor will wait for new DAMM positions to be created\n");
        
        // Don't scan existing positions - just wait for new ones
        // This prevents hanging on dust position calculations
    }
    
    /**
     * Send Discord notification for position closed
     */
    private async sendPositionClosedNotification(result: PositionCloseResult, position: PositionInfo): Promise<void> {
        try {
            // Get token names from the tokens received
            const tokenDetails = result.tokensReceived.map(token => {
                const amount = parseFloat(token.amount) / 1000000; // Convert from raw units
                return `${token.mint}: ${amount.toLocaleString()}`;
            }).join(', ');
            
            const embed = {
                title: "🎯 DAMM Position Auto-Closed",
                color: 0x00ff00, // Green
                fields: [
                    {
                        name: "Position",
                        value: position.position.toBase58(),
                        inline: false
                    },
                    {
                        name: "Pool",
                        value: position.poolAddress.toBase58(),
                        inline: false
                    },
                    {
                        name: "Tokens Received",
                        value: tokenDetails || "None",
                        inline: false
                    },
                    {
                        name: "Transaction",
                        value: `[View on Solscan](https://solscan.io/tx/${result.signature})`,
                        inline: false
                    },
                    {
                        name: "Wallet",
                        value: this.wallet.getPublicKey().toBase58(),
                        inline: false
                    }
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: "DAMM Position Monitor"
                }
            };
            
            await this.sendDiscordNotification("Position Auto-Closed", embed);
            console.log(`   📢 Discord notification sent for position close`);
            
        } catch (error) {
            console.error(`   ❌ Failed to send Discord notification: ${error}`);
        }
    }
    
    /**
     * Send Discord notification for successful token swap
     */
    private async sendSwapNotification(result: SwapResult, token: TokenBalance): Promise<void> {
        try {
            const embed = {
                title: "💰 Token Auto-Swapped to SOL",
                color: 0x00ff00, // Green
                fields: [
                    {
                        name: "Token Mint",
                        value: token.mint,
                        inline: false
                    },
                    {
                        name: "Amount Swapped",
                        value: token.balance.toLocaleString(),
                        inline: true
                    },
                    {
                        name: "USD Value",
                        value: `$${token.jupiterUsdValue?.toFixed(6) || 'Unknown'}`,
                        inline: true
                    },
                    {
                        name: "Transaction",
                        value: `[View on Solscan](https://solscan.io/tx/${result.signature})`,
                        inline: false
                    },
                    {
                        name: "Wallet",
                        value: this.wallet.getPublicKey().toBase58(),
                        inline: false
                    }
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: "DAMM Position Monitor"
                }
            };
            
            await this.sendDiscordNotification("Token Auto-Swapped", embed);
            console.log(`   📢 Discord notification sent for token swap`);
            
        } catch (error) {
            console.error(`   ❌ Failed to send Discord swap notification: ${error}`);
        }
    }
    
    /**
     * Send Discord notification using webhook
     */
    private async sendDiscordNotification(_title: string, embed: any): Promise<void> {
        try {
            if (!this.discordWebhookUrl) {
                console.log(`   📢 Discord webhook not configured, skipping notification`);
                return;
            }
            
            const payload = {
                embeds: [embed]
            };
            
            const response = await fetch(this.discordWebhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });
            
            if (!response.ok) {
                throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
            }
            
        } catch (error) {
            console.error(`   ❌ Discord webhook failed: ${error}`);
        }
    }
    
    /**
     * Utility function for sleeping
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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
        const monitor = new DammPositionMonitor(connection, wallet, cfg.discordWebhook);
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Received SIGINT, shutting down gracefully...');
            monitor.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
            monitor.stop();
            process.exit(0);
        });
        
        // Start monitoring
        await monitor.start();
        
        // Keep the process running
        await new Promise(() => {}); // Never resolves
        
    } catch (error) {
        console.error("❌ Error:", error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
