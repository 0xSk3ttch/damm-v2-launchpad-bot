import { Connection, PublicKey } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { MigrationTracker } from '../services/migration-tracker';
import { PoolCriteriaChecker } from '../services/pool-criteria-checker';

import { DiscordNotifier } from '../services/discord-notifier';
import { JupiterSwapService } from '../services/jupiter-swap-service';
import { DammLiquidityService } from '../services/damm-liquidity-service';

export interface DammPoolMonitorOptions {
  connection: Connection;
  checkIntervalMs?: number;
  discordWebhookUrl: string;
  wallet: any; // Wallet for executing swaps
  swapAmountSol?: number; // Amount of SOL to swap (default 0.02)
  addLiquidity?: boolean; // Whether to automatically add liquidity to matching pools
}

export class DammPoolMonitor {
  private readonly connection: Connection;
  private readonly cpAmm: CpAmm;
  private readonly migrationTracker: MigrationTracker;
  private readonly criteriaChecker: PoolCriteriaChecker;
  private readonly discord: DiscordNotifier;
  private readonly jupiterService: JupiterSwapService;
  private readonly liquidityService: DammLiquidityService;
  private readonly checkIntervalMs: number;
  private readonly wallet: any;
  private readonly swapAmountSol: number;
  private readonly addLiquidity: boolean;
  
  private readonly DAMM_V2_PROGRAM = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
  private readonly POOL_ACCOUNT_SIZE = 1112;
  private readonly TOKEN_OFFSET = 168;
  private readonly WSOL_MINT = "So11111111111111111111111111111111111111112"; // Wrapped SOL (required by Jupiter)
  
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private seenPools = new Set<string>();
  private processedTokenPoolPairs = new Set<string>(); // Track token+pool combinations


  constructor(options: DammPoolMonitorOptions) {
    this.connection = options.connection;
    this.cpAmm = new CpAmm(options.connection);
    this.migrationTracker = new MigrationTracker();
    this.criteriaChecker = new PoolCriteriaChecker();
    this.discord = new DiscordNotifier(options.discordWebhookUrl);
    this.jupiterService = new JupiterSwapService(options.connection);
    this.liquidityService = new DammLiquidityService(options.connection);
    this.checkIntervalMs = options.checkIntervalMs || 20000; // Default 20 seconds
    this.wallet = options.wallet;
    this.swapAmountSol = options.swapAmountSol || 0.01; // 0.01 SOL per token (reduced to ensure sufficient balance for fees
    this.addLiquidity = options.addLiquidity || false; // Default to false for safety
    
    // System is now production-ready - only responds to real Pump.fun migrations
    console.log('🚀 Production mode: Only real migrations will trigger pool monitoring');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ DAMM Pool Monitor is already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting DAMM Pool Monitor...');
    console.log(`🎯 Monitoring for DAMM v2 pools with our criteria:`);
    console.log(`   1. Contains WSOL or SOL`);
    console.log(`   2. Contains migrated token`);
    console.log(`   3. Fees paid in quote token (SOL/WSOL)`);
    console.log(`   4. Quote token only fees (not quote + pool token)`);
    console.log(`📊 Checking every ${this.checkIntervalMs / 1000} seconds...`);
    console.log(`🔑 Connected Wallet: ${this.wallet.getPublicKey().toBase58()}`);
    console.log(`💰 Auto-Purchase Amount: ${this.swapAmountSol} SOL per token`);
    console.log('');

    // Start the monitoring loop
    this.startMonitoringLoop();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.migrationTracker.cleanup();
    console.log('🛑 DAMM Pool Monitor stopped');
  }

  // Public method to add migrated tokens (called from migration monitor)
  addMigratedToken(tokenMint: string): void {
    this.migrationTracker.addToken(tokenMint);
  }

  // Public method to remove tokens (for testing or manual management)
  removeMigratedToken(tokenMint: string): void {
    this.migrationTracker.removeToken(tokenMint);
  }

  // Public method to get current token count
  getPendingTokenCount(): number {
    return this.migrationTracker.getTokenCount();
  }

  // Execute automatic token purchase when pool is found
  private async executeTokenPurchase(tokenMint: string, _pool: any): Promise<void> {
    try {
      console.log(`💰 Executing automatic token purchase for ${tokenMint}`);
      
      // Check if we already have the token in our wallet
      const walletHasToken = await this.jupiterService.checkWalletTokenBalance(tokenMint, this.wallet);
      if (walletHasToken) {
        console.log(`✅ Wallet already contains ${tokenMint}, skipping purchase`);
        return;
      }

      // Execute Jupiter swap for the configured SOL amount
      const swapOptions = {
        inputMint: this.WSOL_MINT,
        outputMint: tokenMint,
        amount: this.swapAmountSol,
        slippageBps: 2000, // 20% slippage tolerance (hardcoded for now)
      };

      const signature = await this.jupiterService.executeSwap(swapOptions, this.wallet);
      console.log(`✅ Token purchase completed! Transaction: ${signature}`);
      
    } catch (error) {
      console.error(`❌ Error executing token purchase:`, error);
    }
  }

  // Execute liquidity addition to DAMM pool
  private async executeLiquidityAddition(poolAddress: string, tokenMint: string, _pool: any): Promise<void> {
    try {
      console.log(`🏊 Executing liquidity addition to DAMM pool: ${poolAddress}`);
      
      // Wait a bit for the token purchase to settle
      console.log(`⏳ Waiting 5 seconds for token purchase to settle...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Add liquidity using the liquidity service
      const liquidityOptions = {
        poolAddress,
        tokenMint,
        solAmount: this.swapAmountSol, // Use the same amount as the swap
        wallet: this.wallet
      };
      
      const result = await this.liquidityService.addLiquidity(liquidityOptions);
      
      if (result.success) {
        console.log(`✅ Liquidity added successfully to pool ${poolAddress}`);
        if (result.transactionSignature) {
          console.log(`   Transaction: ${result.transactionSignature}`);
        }
        if (result.positionAddress) {
          console.log(`   Position: ${result.positionAddress}`);
        }
        
        // Send Discord notification for successful position creation
        try {
          await this.discord.sendPositionCreatedAlert(tokenMint, poolAddress, this.connection);
          console.log('📢 Position created Discord notification sent successfully');
        } catch (error) {
          console.error('❌ Discord notification failed:', error);
        }
        
        // Remove token from pending list after successful liquidity addition
        this.migrationTracker.removeToken(tokenMint);
        console.log(`✅ Removed token ${tokenMint} from pending list`);
      } else {
        console.error(`❌ Failed to add liquidity: ${result.error}`);
        
        // Even if liquidity fails, the position might have been created
        // Send Discord notification anyway since we see position NFTs in logs
        console.log('⚠️  Liquidity failed but position may have been created - sending notification anyway');
        try {
          await this.discord.sendPositionCreatedAlert(tokenMint, poolAddress, this.connection);
          console.log('📢 Position created Discord notification sent (despite liquidity failure)');
        } catch (error) {
          console.error('❌ Discord notification failed:', error);
        }
      }
      
    } catch (error: any) {
      console.error(`❌ Error executing liquidity addition:`, error);
    }
  }

  private startMonitoringLoop(): void {
    this.checkInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.checkPools();
      }
    }, this.checkIntervalMs);
  }

  private async checkPools(): Promise<void> {
    try {
      const tokenCount = this.migrationTracker.getTokenCount();
      
      if (tokenCount === 0) {
        console.log(`🔍 No migrated tokens to check for pools`);
        return;
      }

      console.log(`🕐 Checking pools at ${new Date().toLocaleTimeString()}`);
      console.log(`🔍 Checking for pools containing ${tokenCount} migrated tokens...`);
      
      const tokens = this.migrationTracker.getTokens();
      
      for (const tokenMint of tokens) {
        await this.checkTokenForPools(tokenMint);
      }
      
      console.log(`⏳ Waiting ${this.checkIntervalMs / 1000} seconds before next check...\n`);
    } catch (err) {
      console.error('❌ Error in pool checking loop:', err);
    }
  }

  private async checkTokenForPools(tokenMint: string): Promise<void> {
    try {
      const tokenCA = new PublicKey(tokenMint);
      
      const accounts = await this.connection.getProgramAccounts(this.DAMM_V2_PROGRAM, {
        filters: [
          { dataSize: this.POOL_ACCOUNT_SIZE },
          { memcmp: { offset: this.TOKEN_OFFSET, bytes: tokenCA.toBase58() } },
        ],
      });

      if (accounts.length === 0) {
        return;
      }

      console.log(`🎯 Found ${accounts.length} candidate pool(s) containing token ${tokenMint}`);
      
      for (const { pubkey } of accounts) {
        const poolAddress = pubkey.toBase58();
        const tokenPoolKey = `${tokenMint}-${poolAddress}`;
        
        if (this.processedTokenPoolPairs.has(tokenPoolKey)) {
          console.log(`   ⏭️  Already processed token ${tokenMint} for pool ${poolAddress}, skipping...`);
          continue; // skip already processed token+pool combinations
        }
        
        if (this.seenPools.has(poolAddress)) {
          console.log(`   ⏭️  Pool ${poolAddress} already seen, skipping...`);
          continue; // skip already seen pools
        }
        
        console.log(`   🔍 Checking pool ${poolAddress} for token ${tokenMint}...`);

        try {
          const pool = await this.cpAmm.fetchPoolState(pubkey);
          
          // Apply our filtering criteria
          if (await this.criteriaChecker.meetsAllCriteria(pool, tokenCA)) {
            console.log(`🚨 MATCHING POOL FOUND! 🎉`);
            console.log(`   Pool: ${pubkey.toBase58()}`);
            console.log(`   Token A: ${pool.tokenAMint.toString()}`);
            console.log(`   Token B: ${pool.tokenBMint.toString()}`);
            
            // IMMEDIATELY mark this token+pool combination as processed to prevent duplicates
            this.processedTokenPoolPairs.add(tokenPoolKey);
            this.seenPools.add(poolAddress); // mark pool as seen
            
            // Send Discord notification for qualifying pool found
            try {
              await this.discord.sendPoolFoundAlert(tokenMint, pubkey.toBase58(), this.connection);
              console.log('📢 Pool found Discord notification sent successfully');
            } catch (error) {
              console.error('❌ Discord pool found notification failed:', error);
            }
            
            try {
              // Execute automatic token purchase
              console.log(`💰 Executing automatic token purchase for ${tokenMint}`);
              await this.executeTokenPurchase(tokenMint, pool);
              
              // Add liquidity to the pool if enabled
              if (this.addLiquidity) {
                console.log(`🏊 Executing liquidity addition to DAMM pool: ${pubkey.toBase58()}`);
                console.log(`   💰 Will use ALL available tokens and calculate required SOL amount`);
                await this.executeLiquidityAddition(pubkey.toBase58(), tokenMint, pool);
              }
              
            } catch (error: any) {
              console.error(`❌ Error processing token ${tokenMint}:`, error.message);
            }
            
            // Remove token from pending list since we found a pool
            this.migrationTracker.removeToken(tokenMint);
            console.log(`✅ Removed token ${tokenMint} from pending list - pool found!`);
            
            // Break out of the pool loop since we found a qualifying pool for this token
            break;
          }

        } catch (err) {
          console.error(`❌ Error fetching pool ${pubkey.toBase58()}:`, err);
        }
      }
    } catch (err) {
      console.error(`❌ Error checking pools for token ${tokenMint}:`, err);
    }
  }
}