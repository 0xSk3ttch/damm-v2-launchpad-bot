import { Connection, PublicKey, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import BN from 'bn.js';

export interface LiquidityOptions {
  poolAddress: string;
  tokenMint: string;
  solAmount: number; // Amount of SOL to use for liquidity (per side)
  wallet: any;
}

export interface LiquidityResult {
  success: boolean;
  transactionSignature?: string;
  error?: string;
  positionAddress?: string;
}

export class DammLiquidityService {
  private readonly connection: Connection;
  private readonly cpAmm: CpAmm;
  private readonly WSOL_MINT = "So11111111111111111111111111111111111111112";

  constructor(connection: Connection) {
    this.connection = connection;
    this.cpAmm = new CpAmm(connection);
  }

  /**
   * Add liquidity to a DAMM pool with equal amounts of tokens and SOL
   * This creates a balanced position in the pool
   */
  async addLiquidity(options: LiquidityOptions): Promise<LiquidityResult> {
    try {
      console.log(`🏊 Adding liquidity to DAMM pool: ${options.poolAddress}`);
      console.log(`   Token: ${options.tokenMint}`);
      console.log(`   SOL Amount: ${options.solAmount} SOL per side`);
      console.log(`   Total Position: ${options.solAmount * 2} SOL equivalent`);

      const walletPubkey = options.wallet.getPublicKey ? options.wallet.getPublicKey() : options.wallet.publicKey;
      
      // Check wallet balances
      const solBalance = await this.connection.getBalance(walletPubkey);
      const requiredSol = Math.floor((options.solAmount * 2 + 0.01) * 1e9); // Double the amount + fees
      
      if (solBalance < requiredSol) {
        const error = `Insufficient SOL balance. Required: ${(requiredSol / 1e9).toFixed(3)} SOL, Available: ${(solBalance / 1e9).toFixed(3)} SOL`;
        console.error(`❌ ${error}`);
        return { success: false, error };
      }

      console.log(`💰 Wallet balance: ${(solBalance / 1e9).toFixed(3)} SOL, Required: ${(requiredSol / 1e9).toFixed(3)} SOL`);

      // Check if we have the token with retry mechanism
      let tokenBalance = await this.checkTokenBalance(options.tokenMint, walletPubkey);
      if (!tokenBalance) {
        console.log(`⏳ Token not found immediately, waiting for settlement...`);
        
        // Wait up to 30 seconds for the token to appear (Jupiter swaps can take time)
        for (let attempt = 1; attempt <= 6; attempt++) {
          const waitTime = attempt * 5000; // 5s, 10s, 15s, 20s, 25s, 30s
          console.log(`   Attempt ${attempt}/6: Waiting ${waitTime/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          tokenBalance = await this.checkTokenBalance(options.tokenMint, walletPubkey);
          if (tokenBalance) {
            console.log(`✅ Token found after ${waitTime/1000} seconds!`);
            break;
          }
          
          if (attempt === 6) {
            const error = `Token ${options.tokenMint} not found in wallet after 30 seconds`;
            console.error(`❌ ${error}`);
            return { success: false, error };
          }
        }
      }

      console.log(`🪙 Token balance: ${tokenBalance} tokens`);

      // Ensure we have token accounts for both tokens
      await this.ensureTokenAccounts(options.tokenMint, walletPubkey);

      // Fetch pool state to understand the pool structure
      console.log(`🔍 Fetching pool state for ${options.poolAddress}...`);
      const poolPubkey = new PublicKey(options.poolAddress);
      const poolState = await this.cpAmm.fetchPoolState(poolPubkey);
      
      console.log(`📊 Pool Information:`);
      console.log(`   Token A: ${poolState.tokenAMint.toString()}`);
      console.log(`   Token B: ${poolState.tokenBMint.toString()}`);
      console.log(`   Pool Type: CP-AMM`);

      // Determine which token is which (A or B) and calculate amounts
      const isTokenA = poolState.tokenAMint.toString() === options.tokenMint;
      const isTokenB = poolState.tokenBMint.toString() === options.tokenMint;
      const isSOLTokenA = poolState.tokenAMint.toString() === this.WSOL_MINT;
      const isSOLTokenB = poolState.tokenBMint.toString() === this.WSOL_MINT;

      if (!isTokenA && !isTokenB) {
        const error = `Token ${options.tokenMint} not found in pool ${options.poolAddress}`;
        console.error(`❌ ${error}`);
        return { success: false, error };
      }

      if (!isSOLTokenA && !isSOLTokenB) {
        const error = `SOL/WSOL not found in pool ${options.poolAddress}`;
        console.error(`❌ ${error}`);
        return { success: false, error };
      }

      // Calculate amounts based on the token we want to use
      // Use 100% of the tokens we bought for the SOL amount we spent
      const targetTokenAmount = tokenBalance!; // Use 100% of our token balance (we know it's not null here)
      const solAmount = Math.floor(options.solAmount * 1e9); // Convert to lamports

      console.log(`📊 Liquidity amounts calculated:`);
      console.log(`   Target token amount: ${targetTokenAmount}`);
      console.log(`   SOL amount: ${solAmount} lamports (${options.solAmount} SOL)`);
      
      // The issue: Meteora SDK calculates its own amounts, we need to let it do that
      // Instead of forcing our amounts, we should use the SDK's calculation methods

      // Get wallet keypair for signing transactions
      const keypair = options.wallet.getKeypair ? options.wallet.getKeypair() : options.wallet;
      
      // 🎯 BREAKTHROUGH: Now using the REAL DAMM v2 SDK with proper methods!
      // Based on the official documentation: https://github.com/MeteoraAg/damm-v2-sdk/blob/main/docs.md#createPosition
      console.log(`🏊 Using REAL DAMM v2 SDK: createPosition + addLiquidity approach!`);
      
      // Use the working approach: createPositionAndAddLiquidity in a single transaction
      console.log(`🏗️  Using single transaction approach: createPositionAndAddLiquidity...`);
      
      // Generate new position NFT keypair
      const positionNft = Keypair.generate();
      console.log(`   Position NFT: ${positionNft.publicKey.toString()}`);
      
      // Calculate liquidity delta using the working method
      console.log(`📊 Calculating liquidity delta using getLiquidityDelta...`);
      const liquidityDelta = this.cpAmm.getLiquidityDelta({
        maxAmountTokenA: new BN(targetTokenAmount),
        maxAmountTokenB: new BN(solAmount),
        sqrtPrice: poolState.sqrtPrice,
        sqrtMinPrice: poolState.sqrtMinPrice,
        sqrtMaxPrice: poolState.sqrtMaxPrice,
        tokenAInfo: undefined, // No special token info needed
      });
      
      console.log(`📊 Liquidity delta calculated: ${liquidityDelta.toString()}`);
      
      // Create position and add liquidity in a single transaction
      const createPositionAndAddLiquidityTx = await this.cpAmm.createPositionAndAddLiquidity({
        owner: walletPubkey,
        pool: poolPubkey,
        positionNft: positionNft.publicKey,
        liquidityDelta,
        maxAmountTokenA: new BN(targetTokenAmount),
        maxAmountTokenB: new BN(solAmount),
        tokenAAmountThreshold: new BN(targetTokenAmount), // Accept the full amount
        tokenBAmountThreshold: new BN(solAmount), // Accept the full amount
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        tokenBProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      });
      
      console.log(`📝 Signing and sending createPositionAndAddLiquidity transaction...`);
      
      // Sign and send the transaction
      const { blockhash } = await this.connection.getLatestBlockhash();
      createPositionAndAddLiquidityTx.recentBlockhash = blockhash;
      createPositionAndAddLiquidityTx.feePayer = walletPubkey;
      createPositionAndAddLiquidityTx.sign(keypair, positionNft);
      
      const signature = await sendAndConfirmTransaction(
        this.connection,
        createPositionAndAddLiquidityTx,
        [keypair, positionNft],
        { commitment: 'confirmed' }
      );
      
      console.log(`🎉 SUCCESS! Position created and liquidity added to DAMM pool!`);
      console.log(`   Position NFT: ${positionNft.publicKey.toString()}`);
      console.log(`   Liquidity Added: ${targetTokenAmount} tokens + ${solAmount} lamports`);
      console.log(`   Transaction: ${signature}`);
      console.log(`   🔗 View position: https://explorer.solana.com/address/${positionNft.publicKey.toString()}`);
      console.log(`   🔗 View transaction: https://explorer.solana.com/tx/${signature}`);

      return {
        success: true,
        transactionSignature: signature,
        positionAddress: positionNft.publicKey.toString()
      };

    } catch (error: any) {
      console.error(`❌ Error adding liquidity to DAMM pool:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if wallet has a token and return balance
   */
  private async checkTokenBalance(tokenMint: string, walletPubkey: PublicKey): Promise<number | null> {
    try {
      const tokenAccount = await getAssociatedTokenAddress(
        new PublicKey(tokenMint),
        walletPubkey
      );

      const accountInfo = await getAccount(this.connection, tokenAccount);
      return Number(accountInfo.amount);
    } catch (error) {
      return null; // Token account doesn't exist
    }
  }



  /**
   * Ensure token accounts exist for the wallet
   */
  private async ensureTokenAccounts(tokenMint: string, walletPubkey: PublicKey): Promise<void> {
    try {
      // Check both the target token and WSOL accounts
      const tokenMints = [tokenMint, this.WSOL_MINT];
      
      for (const mint of tokenMints) {
        const tokenAccount = await getAssociatedTokenAddress(
          new PublicKey(mint),
          walletPubkey
        );

        // Check if account exists
        try {
          await getAccount(this.connection, tokenAccount);
          console.log(`✅ Token account exists for ${mint === this.WSOL_MINT ? 'WSOL' : 'token'}`);
        } catch {
          // Account doesn't exist - this is okay, the SDK will handle creation
          console.log(`📝 Token account will be created by SDK for ${mint === this.WSOL_MINT ? 'WSOL' : 'token'}`);
          console.log(`   Account: ${tokenAccount.toBase58()}`);
        }
      }
    } catch (error: any) {
      console.error(`❌ Error checking token accounts:`, error);
      throw error;
    }
  }

  /**
   * Get pool information for a DAMM pool
   */
  async getPoolInfo(poolAddress: string): Promise<any> {
    try {
      // TODO: Implement pool info retrieval using Meteora SDK
      // This would give us details about the pool structure, fees, etc.
      console.log(`🔍 Getting pool info for: ${poolAddress}`);
      
      // Placeholder - implement with actual SDK calls
      return {
        address: poolAddress,
        tokenAMint: 'UNKNOWN',
        tokenBMint: 'UNKNOWN',
        fee: 'UNKNOWN'
      };
    } catch (error: any) {
      console.error(`❌ Error getting pool info:`, error);
      return null;
    }
  }
}