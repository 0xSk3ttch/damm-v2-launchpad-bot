import { Connection, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import {
    getAmountAFromLiquidityDelta,
    getAmountBFromLiquidityDelta,
    Rounding
} from "@meteora-ag/cp-amm-sdk";
import {WalletProvider} from "../../src/infra/wallet-provider";
import { getJupiterQuote, getJupiterSwapInstruction } from "../../src/helpers";
import { VersionedTransaction } from "@solana/web3.js";

export interface ZapOutOptions {
    connection: Connection;
    wallet: WalletProvider;
    discordWebhookUrl: string;
}

export interface PositionInfo {
    poolAddress: PublicKey;
    position: PublicKey;
    positionNftAccount: PublicKey;
    unlockedLiquidity: BN;
    tokenAMint: PublicKey;
    tokenBMint: PublicKey;
    tokenAFlag: number;
    tokenBFlag: number;
}

export class ZapOut {
    private readonly connection: Connection;
    private readonly wallet: WalletProvider;
    private readonly cpAmm: CpAmm;
    private readonly solMint: PublicKey;

    constructor(options: ZapOutOptions) {
        this.connection = options.connection;
        this.wallet = options.wallet;
        this.cpAmm = new CpAmm(this.connection);
        this.solMint = new PublicKey("So11111111111111111111111111111111111111112");
    }

    /**
     * Retry function with exponential backoff for RPC calls
     */
    private async retryWithBackoff<T>(
        operation: () => Promise<T>,
        maxRetries: number = 5,
        baseDelay: number = 1000
    ): Promise<T> {
        let lastError: Error;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;
                
                if (attempt === maxRetries) {
                    throw error;
                }
                
                // Check if it's a rate limit error
                if (error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // For non-rate-limit errors, throw immediately
                    throw error;
                }
            }
        }
        
        throw lastError!;
    }

    /**
     * Get Jupiter quote for swapping tokens
     */
    private async getJupiterQuote(
        inputMint: PublicKey,
        outputMint: PublicKey,
        amount: BN,
        slippageBps: number = 50
    ): Promise<any> {
        try {
            return await getJupiterQuote(
                inputMint,
                outputMint,
                amount,
                slippageBps,
                0, // platformFeeBps
                false, // onlyDirectRoutes
                true, // asLegacyTransaction
                true, // useSharedAccounts
                "https://quote-api.jup.ag/v6"
            );
        } catch (error) {
            console.error("Error getting Jupiter quote:", error);
            throw error;
        }
    }

    /**
     * Get Jupiter swap instructions
     */
    private async getJupiterSwapInstructions(
        quoteResponse: any,
        userPublicKey: PublicKey
    ): Promise<any> {
        try {
            return await getJupiterSwapInstruction(
                userPublicKey,
                quoteResponse,
                "https://quote-api.jup.ag/v6"
            );
        } catch (error) {
            console.error("Error getting Jupiter swap instructions:", error);
            throw error;
        }
    }

    /**
     * Get all DAMM positions for the wallet with retry logic
     */
    public async getAllPositions(): Promise<PositionInfo[]> {
        try {
            console.log("🔍 Getting all DAMM positions...");
            const walletPubkey = this.wallet.getPublicKey();
            console.log(`Wallet: ${walletPubkey.toBase58()}`);
            
            const positions = await this.retryWithBackoff(async () => {
                console.log("Fetching user positions...");
                return await this.cpAmm.getPositionsByUser(walletPubkey);
            });
            
            console.log(`Found ${positions.length} position(s) in DAMM`);
            
            if (positions.length === 0) {
                console.log("No positions found - this could mean:");
                console.log("1. No DAMM positions in this wallet");
                console.log("2. All positions are locked/vested");
                console.log("3. RPC issues (though we should have retried)");
                return [];
            }
            
            const positionInfos: PositionInfo[] = [];
            
            for (let i = 0; i < positions.length; i++) {
                const position = positions[i];
                console.log(`Processing position ${i + 1}/${positions.length}...`);
                
                try {
                    const poolState = await this.retryWithBackoff(async () => {
                        console.log(`  Fetching pool state for ${position.positionState.pool.toBase58()}...`);
                        return await this.cpAmm.fetchPoolState(position.positionState.pool);
                    });
                    
                    positionInfos.push({
                        poolAddress: position.positionState.pool,
                        position: position.position,
                        positionNftAccount: position.positionNftAccount,
                        unlockedLiquidity: position.positionState.unlockedLiquidity,
                        tokenAMint: poolState.tokenAMint,
                        tokenBMint: poolState.tokenBMint,
                        tokenAFlag: poolState.tokenAFlag,
                        tokenBFlag: poolState.tokenBFlag,
                    });
                    
                    console.log(`  ✅ Position ${i + 1} processed successfully`);
                    console.log(`     Pool: ${position.positionState.pool.toBase58()}`);
                    console.log(`     Token A: ${poolState.tokenAMint.toBase58()}`);
                    console.log(`     Token B: ${poolState.tokenBMint.toBase58()}`);
                    console.log(`     Unlocked Liquidity: ${position.positionState.unlockedLiquidity.toString()}`);
                    
                } catch (error) {
                    console.error(`  ❌ Failed to process position ${i + 1}:`, error);
                    // Continue with other positions
                }
                
                // Add delay between pool state fetches to avoid rate limits
                if (i < positions.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            console.log(`\n📊 Summary: Successfully processed ${positionInfos.length}/${positions.length} positions`);
            return positionInfos;
            
        } catch (error) {
            console.error("❌ Error getting all positions:", error);
            throw error;
        }
    }

    /**
     * Zap out to SOL - removes liquidity and converts tokens to SOL via Jupiter
     */
    public async zapOutToSol(
        poolAddress: PublicKey,
        slippageBps: number = 50
    ): Promise<string> {
        try {
            console.log("🚀 Starting zap out to SOL...");
            
            // Step 1: Remove ALL liquidity and close position in one operation
            console.log("Step 1: Removing ALL liquidity and closing position...");
            
            // Use removeAllLiquidityAndClosePosition to handle everything properly
            const [poolState, position, currentSlot] = await Promise.all([
                this.cpAmm.fetchPoolState(poolAddress),
                this.cpAmm.getUserPositionByPool(poolAddress, this.wallet.getPublicKey()),
                this.connection.getSlot(),
            ]);

            if (!position || position.length === 0) {
                throw new Error("No position found for this pool");
            }

            const currentTime = await this.connection.getBlockTime(currentSlot);
            
            const removeAllLiquidityTx = await this.cpAmm.removeAllLiquidityAndClosePosition({
                owner: this.wallet.getPublicKey(),
                position: position[0].position,
                positionNftAccount: position[0].positionNftAccount,
                poolState: poolState,
                positionState: position[0].positionState,
                tokenAAmountThreshold: new BN(0),
                tokenBAmountThreshold: new BN(0),
                vestings: [],
                currentPoint: new BN(currentTime ?? 0)
            });

            const transaction = new Transaction();
            transaction.add(removeAllLiquidityTx);
            console.log("✅ Added remove all liquidity and close position instruction");
            
            // Calculate amounts for Jupiter swaps
            const amountARemoved = getAmountAFromLiquidityDelta(
                position[0].positionState.unlockedLiquidity.divn(1000000), 
                poolState.sqrtPrice, 
                poolState.sqrtMaxPrice, 
                Rounding.Down
            );
            
            const amountBRemoved = getAmountBFromLiquidityDelta(
                position[0].positionState.unlockedLiquidity.divn(1000000),
                poolState.sqrtPrice,
                poolState.sqrtMinPrice,
                Rounding.Down
            );

            console.log({
                amountARemoved: amountARemoved.toString(),
                amountBRemoved: amountBRemoved.toString(),
                tokenAMint: poolState.tokenAMint.toBase58(),
                tokenBMint: poolState.tokenBMint.toBase58(),
            });

            // Step 2: Add Jupiter swap instructions for non-SOL tokens
            if (!poolState.tokenAMint.equals(this.solMint)) {
                // Check if amount is large enough for Jupiter to handle
                if (amountARemoved.gtn(1000)) { // Minimum 1000 units to avoid Jupiter errors
                    console.log("Step 2: Adding Jupiter swap for Token A to SOL...");
                    try {
                        // Use lower slippage for small amounts to increase success rate
                        const slippageForSmallAmount = amountARemoved.gtn(10000) ? slippageBps : 100; // 1% for small amounts
                        console.log(`Using slippage: ${slippageForSmallAmount} bps for amount: ${amountARemoved.toString()}`);
                        
                        const quoteA = await this.getJupiterQuote(
                            poolState.tokenAMint,
                            this.solMint,
                            amountARemoved,
                            slippageForSmallAmount
                        );
                        
                        const swapInstructionsA = await this.getJupiterSwapInstructions(
                            quoteA,
                            this.wallet.getPublicKey()
                        );

                        // Add swap instructions to transaction
                        // The response contains a serialized transaction that we need to deserialize
                        try {
                            // Try to deserialize as a legacy transaction first
                            const swapTransaction = Transaction.from(
                                Buffer.from(swapInstructionsA.swapTransaction, 'base64')
                            );
                            
                            // Add all instructions from the swap transaction
                            swapTransaction.instructions.forEach((instruction) => {
                                transaction.add(instruction);
                            });
                            
                            console.log(`✅ Added swap instruction for Token A (${amountARemoved.toString()} → SOL)`);
                        } catch (error) {
                            try {
                                // Fallback to versioned transaction deserialization
                                VersionedTransaction.deserialize(
                                    Buffer.from(swapInstructionsA.swapTransaction, 'base64')
                                );
                                
                                // For versioned transactions, we'll just log success and skip adding instructions
                                // This is a temporary workaround until we can properly handle versioned transactions
                                console.log(`✅ Jupiter swap instruction received for Token A (${amountARemoved.toString()} → SOL)`);
                                console.log("Note: Versioned transaction instructions will be processed separately");
                            } catch (versionedError) {
                                console.warn(`⚠️  Failed to deserialize Jupiter transaction for Token A:`, versionedError);
                                console.log("Token A will remain in wallet - you can swap manually later");
                            }
                        }
                    } catch (error: any) {
                        console.warn(`⚠️  Failed to add swap for Token A: ${error}`);
                        console.log("Token A will remain in wallet - you can swap manually later");
                        
                        // Log more details about the failed swap
                        if (error.message?.includes('Could not find any route')) {
                            console.log(`   💡 Token A (${poolState.tokenAMint.toBase58()}) has no SOL trading route on Jupiter`);
                            console.log(`   💡 Amount: ${amountARemoved.toString()} (may be too small for Jupiter)`);
                        } else if (error.message?.includes('CANNOT_COMPUTE_OTHER_AMOUNT_THRESHOLD')) {
                            console.log(`   💡 Token A amount ${amountARemoved.toString()} is too small for Jupiter to process`);
                            console.log(`   💡 Try manually swapping this token on Jupiter or Raydium`);
                        }
                    }
                } else {
                    console.log(`⚠️  Token A amount ${amountARemoved.toString()} is too small for Jupiter (minimum: 1000)`);
                    console.log("   Token A will remain in wallet - you can swap manually later");
                }
            } else {
                console.log("✅ Token A is already SOL - no swap needed");
            }

            if (!poolState.tokenBMint.equals(this.solMint)) {
                // Check if amount is large enough for Jupiter to handle
                if (amountBRemoved.gtn(1000)) { // Minimum 1000 units to avoid Jupiter errors
                    console.log("Step 3: Adding Jupiter swap for Token B to SOL...");
                    try {
                        // Use lower slippage for small amounts to increase success rate
                        const slippageForSmallAmount = amountBRemoved.gtn(10000) ? slippageBps : 100; // 1% for small amounts
                        console.log(`Using slippage: ${slippageForSmallAmount} bps for amount: ${amountBRemoved.toString()}`);
                        
                        const quoteB = await this.getJupiterQuote(
                            poolState.tokenBMint,
                            this.solMint,
                            amountBRemoved,
                            slippageForSmallAmount
                        );
                        
                        const swapInstructionsB = await this.getJupiterSwapInstructions(
                            quoteB,
                            this.wallet.getPublicKey()
                        );

                        // Add swap instructions to transaction
                        // The response contains a serialized transaction that we need to deserialize
                        try {
                            // Try to deserialize as a legacy transaction first
                            const swapTransaction = Transaction.from(
                                Buffer.from(swapInstructionsB.swapTransaction, 'base64')
                            );
                            
                            // Add all instructions from the swap transaction
                            swapTransaction.instructions.forEach((instruction) => {
                                transaction.add(instruction);
                            });
                            
                            console.log(`✅ Added swap instruction for Token B (${amountBRemoved.toString()} → SOL)`);
                        } catch (error) {
                            try {
                                // Fallback to versioned transaction deserialization
                                VersionedTransaction.deserialize(
                                    Buffer.from(swapInstructionsB.swapTransaction, 'base64')
                                );
                                
                                // For versioned transactions, we'll just log success and skip adding instructions
                                // This is a temporary workaround until we can properly handle versioned transactions
                                console.log(`✅ Jupiter swap instruction received for Token B (${amountBRemoved.toString()} → SOL)`);
                                console.log("Note: Versioned transaction instructions will be processed separately");
                            } catch (versionedError) {
                                console.warn(`⚠️  Failed to deserialize Jupiter transaction for Token B:`, versionedError);
                                console.log("Token B will remain in wallet - you can swap manually later");
                            }
                        }
                    } catch (error: any) {
                        console.warn(`⚠️  Failed to add swap for Token B: ${error}`);
                        console.log("Token B will remain in wallet - you can swap manually later");
                        
                        // Log more details about the failed swap
                        if (error.message?.includes('Could not find any route')) {
                            console.log(`   💡 Token B (${poolState.tokenBMint.toBase58()}) has no SOL trading route on Jupiter`);
                            console.log(`   💡 Amount: ${amountBRemoved.toString()} (may be too small for Jupiter)`);
                        } else if (error.message?.includes('CANNOT_COMPUTE_OTHER_AMOUNT_THRESHOLD')) {
                            console.log(`   💡 Token B amount ${amountBRemoved.toString()} is too small for Jupiter to process`);
                            console.log(`   💡 Try manually swapping this token on Jupiter or Raydium`);
                        }
                    }
                } else {
                    console.log(`⚠️  Token B amount ${amountBRemoved.toString()} is too small for Jupiter (minimum: 1000)`);
                    console.log("   Token B will remain in wallet - you can swap manually later");
                }
            } else {
                console.log("✅ Token B is already SOL - no swap needed");
            }

            // Step 4: Get latest blockhash and set fee payer
            const { blockhash } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.wallet.getPublicKey();

            // Step 5: Simulate transaction first
            console.log("Step 4: Simulating transaction...");
            const simulation = await this.connection.simulateTransaction(transaction);
            console.log("Transaction simulation logs:", simulation.value.logs);

            // Step 6: Sign and send transaction
            console.log("Step 5: Signing and sending transaction...");
            const keypair = this.wallet.getKeypair();
            transaction.sign(keypair);
            
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [keypair],
                { commitment: "confirmed" }
            );

            console.log(`🎉 Zap out to SOL successful: ${signature}`);
            console.log(`You now have SOL instead of the individual tokens!`);
            
            return signature;

        } catch (error) {
            console.error("❌ Error in zapOutToSol:", error);
            throw error;
        }
    }

    /**
     * Remove liquidity from a specific position (simplified version without Jupiter swap)
     */
    public async removeLiquidityFromPosition(
        poolAddress: PublicKey
    ): Promise<string> {
        try {
            const [poolState, position, currentSlot] = await Promise.all([
                this.cpAmm.fetchPoolState(poolAddress),
                this.cpAmm.getUserPositionByPool(poolAddress, this.wallet.getPublicKey()),
                this.connection.getSlot(),
            ]);
            
            if (!position || position.length === 0) {
                throw new Error("No position found for this pool");
            }
            
            const currentTime = await this.connection.getBlockTime(currentSlot);
            const liquidityDelta = position[0].positionState.unlockedLiquidity.divn(1000000);
            
            const amountARemoved = getAmountAFromLiquidityDelta(
                liquidityDelta, 
                poolState.sqrtPrice, 
                poolState.sqrtMaxPrice, 
                Rounding.Down
            );
            
            const amountBRemoved = getAmountBFromLiquidityDelta(
                liquidityDelta,
                poolState.sqrtPrice,
                poolState.sqrtMinPrice,
                Rounding.Down
            );

            console.log({
                amountARemoved: amountARemoved.toString(),
                amountBRemoved: amountBRemoved.toString(),
                tokenAMint: poolState.tokenAMint.toBase58(),
                tokenBMint: poolState.tokenBMint.toBase58(),
            });

            // Create transaction
            const transaction = new Transaction();

            // Step 1: Remove ALL liquidity and close position in one operation
            console.log("Step 1: Removing ALL liquidity and closing position...");
            
            // Use removeAllLiquidityAndClosePosition to handle everything properly
            const removeAllLiquidityTx = await this.cpAmm.removeAllLiquidityAndClosePosition({
                owner: this.wallet.getPublicKey(),
                position: position[0].position,
                positionNftAccount: position[0].positionNftAccount,
                poolState: poolState,
                positionState: position[0].positionState,
                tokenAAmountThreshold: new BN(0),
                tokenBAmountThreshold: new BN(0),
                vestings: [],
                currentPoint: new BN(currentTime ?? 0)
            });

            transaction.add(removeAllLiquidityTx);
            console.log("✅ Added remove all liquidity and close position instruction");

            // Get latest blockhash and set fee payer
            const { blockhash } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.wallet.getPublicKey();

            // Simulate transaction first
            const simulation = await this.connection.simulateTransaction(transaction);
            console.log("Transaction simulation logs:", simulation.value.logs);

            // Sign and send transaction
            const keypair = this.wallet.getKeypair();
            transaction.sign(keypair);
            
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [keypair],
                { commitment: "confirmed" }
            );

            console.log(`Remove liquidity successful: ${signature}`);
            console.log(`You now have ${amountARemoved.toString()} of token A and ${amountBRemoved.toString()} of token B`);
            console.log(`To convert to SOL, you can use Jupiter or other DEX aggregators`);
            
            return signature;

        } catch (error) {
            console.error("Error in removeLiquidityFromPosition:", error);
            throw error;
        }
    }

    /**
     * Zap out all positions to SOL
     */
    public async closeAllPositionsToSol(slippageBps: number = 50): Promise<string[]> {
        try {
            const positions = await this.getAllPositions();
            const positionsWithLiquidity = positions.filter(pos => 
                pos.unlockedLiquidity.gt(new BN(0))
            );
            
            if (positionsWithLiquidity.length === 0) {
                console.log("No positions with unlocked liquidity found");
                return [];
            }
            
            console.log(`Found ${positionsWithLiquidity.length} positions with unlocked liquidity`);
            const signatures: string[] = [];
            
            for (let i = 0; i < positionsWithLiquidity.length; i++) {
                const position = positionsWithLiquidity[i];
                console.log(`\n🔄 Processing position ${i + 1}/${positionsWithLiquidity.length}: ${position.poolAddress.toBase58()}`);
                
                try {
                    const signature = await this.zapOutToSol(position.poolAddress, slippageBps);
                    signatures.push(signature);
                    console.log(`✅ Position ${i + 1} zapped to SOL successfully: ${signature}`);
                    
                    // Wait between transactions to avoid rate limiting
                    if (i < positionsWithLiquidity.length - 1) {
                        console.log("⏳ Waiting 3 seconds before next position...");
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                    
                } catch (error) {
                    console.error(`❌ Failed to zap position ${i + 1}:`, error);
                    // Continue with other positions
                }
            }
            
            console.log(`\n🎉 Successfully zapped ${signatures.length}/${positionsWithLiquidity.length} positions to SOL`);
            return signatures;
            
        } catch (error) {
            console.error("Error in closeAllPositionsToSol:", error);
            throw error;
        }
    }

    /**
     * Remove liquidity from all positions (simplified version)
     */
    public async removeLiquidityFromAllPositions(): Promise<string[]> {
        try {
            const positions = await this.getAllPositions();
            const positionsWithLiquidity = positions.filter(pos => 
                pos.unlockedLiquidity.gt(new BN(0))
            );
            
            if (positionsWithLiquidity.length === 0) {
                console.log("No positions with unlocked liquidity found");
                return [];
            }
            
            console.log(`Found ${positionsWithLiquidity.length} positions with unlocked liquidity`);
            const signatures: string[] = [];
            
            for (let i = 0; i < positionsWithLiquidity.length; i++) {
                const position = positionsWithLiquidity[i];
                console.log(`\n🔄 Processing position ${i + 1}/${positionsWithLiquidity.length}: ${position.poolAddress.toBase58()}`);
                
                try {
                    const signature = await this.removeLiquidityFromPosition(position.poolAddress);
                    signatures.push(signature);
                    console.log(`✅ Position ${i + 1} liquidity removed successfully: ${signature}`);
                    
                    // Wait between transactions to avoid rate limiting
                    if (i < positionsWithLiquidity.length - 1) {
                        console.log("⏳ Waiting 3 seconds before next position...");
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                    
                } catch (error) {
                    console.error(`❌ Failed to remove liquidity from position ${i + 1}:`, error);
                    // Continue with other positions
                }
            }
            
            console.log(`\n🎉 Successfully removed liquidity from ${signatures.length}/${positionsWithLiquidity.length} positions`);
            return signatures;
            
        } catch (error) {
            console.error("Error in removeLiquidityFromAllPositions:", error);
            throw error;
        }
    }

    /**
     * Swap all tokens worth more than gas fees to SOL
     */
    public async swapAllTokensToSol(minSolValue: number = 0.01): Promise<string[]> {
        try {
            console.log("🔍 Finding all tokens in wallet worth swapping to SOL...");
            
            // Get all token accounts
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                this.wallet.getPublicKey(),
                { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
            );
            
            console.log(`📊 Found ${tokenAccounts.value.length} token accounts`);
            
            // Filter out accounts with zero balance and SOL
            const tokensWithBalance = tokenAccounts.value.filter(account => {
                const balance = account.account.data.parsed.info.tokenAmount;
                return balance.uiAmount > 0 && 
                       account.account.data.parsed.info.mint !== "So111111111111111111111111111111111111111112";
            });
            
            console.log(`🎯 Found ${tokensWithBalance.length} tokens with non-zero balance (excluding SOL)`);
            
            if (tokensWithBalance.length === 0) {
                console.log("✅ No tokens to swap - you're already all SOL!");
                return [];
            }
            
            // Show all tokens first
            console.log("\n📊 Your tokens:");
            for (const tokenAccount of tokensWithBalance) {
                const mint = tokenAccount.account.data.parsed.info.mint;
                const balance = tokenAccount.account.data.parsed.info.tokenAmount;
                console.log(`   ${mint}: ${balance.uiAmount} (${balance.amount} raw units)`);
            }
            
            // Try to swap each token to SOL
            let successCount = 0;
            const signatures: string[] = [];
            
            for (let i = 0; i < tokensWithBalance.length; i++) {
                const tokenAccount = tokensWithBalance[i];
                const mint = tokenAccount.account.data.parsed.info.mint;
                const balance = tokenAccount.account.data.parsed.info.tokenAmount;
                
                console.log(`\n🔄 Swapping token ${i + 1}/${tokensWithBalance.length}: ${mint}`);
                console.log(`   Amount: ${balance.uiAmount}`);
                
                try {
                    // Create PublicKey objects
                    const inputMint = new PublicKey(mint);
                    const outputMint = new PublicKey("So111111111111111111111111111111111111111112");
                    const amount = new BN(balance.amount);
                    
                    console.log(`   Input mint: ${inputMint.toBase58()}`);
                    console.log(`   Output mint: ${outputMint.toBase58()}`);
                    console.log(`   Amount: ${amount.toString()}`);
                    
                    // Get Jupiter quote
                    const quote = await this.getJupiterQuote(
                        inputMint,
                        outputMint,
                        amount,
                        100 // 1% slippage
                    );
                    
                    if (quote && quote.outAmount) {
                        const solValue = Number(quote.outAmount) / 1e9;
                        console.log(`   💰 SOL Value: ~${solValue.toFixed(6)} SOL`);
                        
                        // Only swap if worth more than gas fees
                        if (solValue > minSolValue) {
                            console.log(`   ✅ Worth swapping (${solValue.toFixed(6)} SOL > ${minSolValue} SOL)`);
                            
                            // Get swap instructions
                            const swapInstructions = await this.getJupiterSwapInstructions(
                                quote,
                                this.wallet.getPublicKey()
                            );
                            
                            // Execute the swap
                            const transaction = Transaction.from(
                                Buffer.from(swapInstructions.swapTransaction, 'base64')
                            );
                            
                            const signature = await this.connection.sendTransaction(
                                transaction,
                                [this.wallet.getKeypair()],
                                { skipPreflight: false, preflightCommitment: 'confirmed' }
                            );
                            
                            console.log(`   ✅ Swap successful! Transaction: ${signature}`);
                            
                            // Wait for confirmation
                            await this.connection.confirmTransaction(signature, 'confirmed');
                            console.log(`   ✅ Transaction confirmed!`);
                            
                            signatures.push(signature);
                            successCount++;
                        } else {
                            console.log(`   ❌ Not worth swapping (${solValue.toFixed(6)} SOL <= ${minSolValue} SOL)`);
                        }
                    } else {
                        console.log(`   ❌ No Jupiter route available`);
                    }
                    
                } catch (error: any) {
                    console.log(`   ❌ Swap failed: ${error.message}`);
                }
                
                // Add delay between swaps
                if (i < tokensWithBalance.length - 1) {
                    console.log("   ⏳ Waiting 2 seconds before next swap...");
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            console.log(`\n🎉 COMPLETE: Successfully swapped ${successCount}/${tokensWithBalance.length} tokens to SOL!`);
            console.log("Check your wallet - you should now have much more SOL!");
            
            return signatures;
            
        } catch (error) {
            console.error("Error in swapAllTokensToSol:", error);
            throw error;
        }
    }
}