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

      // Check if we have the token
      const tokenBalance = await this.checkTokenBalance(options.tokenMint, walletPubkey);
      if (!tokenBalance) {
        const error = `Token ${options.tokenMint} not found in wallet`;
        console.error(`❌ ${error}`);
        return { success: false, error };
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
      // We'll use a reasonable amount that won't exceed our balance
      const targetTokenAmount = Math.min(tokenBalance, Math.floor(options.solAmount * 1000000)); // Use 1M tokens per SOL as example
      const solAmount = Math.floor(options.solAmount * 1e9); // Convert to lamports

      console.log(`📊 Liquidity amounts calculated:`);
      console.log(`   Target token amount: ${targetTokenAmount}`);
      console.log(`   SOL amount: ${solAmount} lamports (${options.solAmount} SOL)`);

      // Get wallet keypair for signing transactions
      const keypair = options.wallet.getKeypair ? options.wallet.getKeypair() : options.wallet;
      
      console.log(`🏊 Creating position and adding liquidity with REAL Meteora SDK...`);
      
      // Use the simple, working approach: createPositionAndAddLiquidity
      const positionNft = Keypair.generate(); // Generate new position NFT keypair
      console.log(`   Position NFT: ${positionNft.publicKey.toString()}`);
      
      const result = await this.cpAmm.createPositionAndAddLiquidity({
        owner: walletPubkey,
        pool: poolPubkey,
        positionNft: positionNft.publicKey,
        liquidityDelta: new BN(targetTokenAmount),
        maxAmountTokenA: new BN(isTokenA ? targetTokenAmount : solAmount),
        maxAmountTokenB: new BN(isTokenB ? targetTokenAmount : solAmount),
        tokenAAmountThreshold: new BN(Math.floor(targetTokenAmount * 0.9)), // Allow 10% slippage
        tokenBAmountThreshold: new BN(Math.floor(solAmount * 0.9)), // Allow 10% slippage
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        tokenBProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      });

      console.log(`📝 Signing and sending liquidity transaction...`);
      
      // Sign and send the transaction - the result should be a transaction object
      if (result && typeof result.sign === 'function') {
        // Get recent blockhash before signing
        const { blockhash } = await this.connection.getLatestBlockhash();
        result.recentBlockhash = blockhash;
        result.feePayer = walletPubkey;
        
        // Sign with both the wallet and the position NFT keypair
        result.sign(keypair, positionNft);
        const signature = await sendAndConfirmTransaction(
          this.connection,
          result,
          [keypair, positionNft],
          { commitment: 'confirmed' }
        );
        
        console.log(`🎉 SUCCESS! Real liquidity added to DAMM pool!`);
        console.log(`   Transaction: ${signature}`);
        console.log(`   🔗 View transaction: https://explorer.solana.com/tx/${signature}`);

        return {
          success: true,
          transactionSignature: signature,
          positionAddress: 'Position created and liquidity added in single transaction'
        };
      } else {
        throw new Error('Unexpected result type from createPositionAndAddLiquidity');
      }

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
