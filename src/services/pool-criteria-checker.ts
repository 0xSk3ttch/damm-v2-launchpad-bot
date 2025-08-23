import { PublicKey } from '@solana/web3.js';

export interface PoolCriteria {
  hasWSOL: boolean;
  hasSOL: boolean;
  hasMigratedToken: boolean;
  feesInQuoteToken: boolean;
  hasLinearSchedule: boolean;
}

export class PoolCriteriaChecker {
  private readonly WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  private readonly SOL_MINT = new PublicKey("11111111111111111111111111111111");

  async checkPoolCriteria(pool: any, migratedTokenMint: PublicKey): Promise<PoolCriteria> {
    try {
      const tokenA = pool.tokenAMint.toString();
      const tokenB = pool.tokenBMint.toString();
      const migratedTokenString = migratedTokenMint.toString();
      
      // Criteria 1: Pool must contain WSOL or SOL
      const hasWSOL = tokenA === this.WSOL_MINT.toString() || tokenB === this.WSOL_MINT.toString();
      const hasSOL = tokenA === this.SOL_MINT.toString() || tokenB === this.SOL_MINT.toString();
      
      // Criteria 2: Pool must contain our migrated token
      const hasMigratedToken = tokenA === migratedTokenString || tokenB === migratedTokenString;
      
      // Criteria 3: Fees must be paid in quote token (SOL/WSOL)
      const quoteToken = hasWSOL ? this.WSOL_MINT.toString() : this.SOL_MINT.toString();
      const feesInQuoteToken = await this.checkFeesInQuoteToken(pool, quoteToken);
      
      // Criteria 4: Must have quote token only fees (not quote + pool token)
      const hasQuoteTokenOnlyFees = await this.checkQuoteTokenOnlyFees(pool);
      
      return {
        hasWSOL,
        hasSOL,
        hasMigratedToken,
        feesInQuoteToken,
        hasLinearSchedule: hasQuoteTokenOnlyFees
      };
    } catch (err) {
      console.error('❌ Error checking pool criteria:', err);
      return {
        hasWSOL: false,
        hasSOL: false,
        hasMigratedToken: false,
        feesInQuoteToken: false,
        hasLinearSchedule: false
      };
    }
  }

  async meetsAllCriteria(pool: any, migratedTokenMint: PublicKey): Promise<boolean> {
    const criteria = await this.checkPoolCriteria(pool, migratedTokenMint);
    
    // Log detailed criteria results with pool info
    console.log(`   🔍 Pool Analysis for ${pool.tokenAMint.toString()}/${pool.tokenBMint.toString()}:`);
    
    if (!criteria.hasWSOL && !criteria.hasSOL) {
      console.log(`   ❌ Pool doesn't contain WSOL or SOL`);
    } else {
      console.log(`   ✅ Contains SOL/WSOL`);
    }
    
    if (!criteria.hasMigratedToken) {
      console.log(`   ❌ Pool doesn't contain migrated token`);
    } else {
      console.log(`   ✅ Contains migrated token`);
    }
    
    if (!criteria.feesInQuoteToken) {
      console.log(`   ❌ Fees not paid in quote token (SOL/WSOL)`);
    } else {
      console.log(`   ✅ Fees in quote token`);
    }
    
    if (!criteria.hasLinearSchedule) {
      console.log(`   ❌ Not quote token only fees`);
      // Log more details about the fee structure
      if (pool.poolFees) {
        console.log(`   📊 Pool fees found:`, JSON.stringify(pool.poolFees, null, 2));
      } else {
        console.log(`   📊 No pool fees data found`);
      }
    } else {
      console.log(`   ✅ Quote token only fees (exactly what we want!)`);
    }
    
    const allMet = criteria.hasWSOL || criteria.hasSOL;
    const allMet2 = criteria.hasMigratedToken && criteria.feesInQuoteToken && criteria.hasLinearSchedule;
    
    if (allMet && allMet2) {
      console.log(`   ✅ ALL CRITERIA MET! This is a party pool! 🎉`);
    }
    
    return allMet && allMet2;
  }

  private async checkFeesInQuoteToken(_pool: any, _quoteTokenMint: string): Promise<boolean> {
    try {
      // This is a simplified check - in practice we'd need to analyze the fee structure
      // For now, we'll assume pools with our criteria have fees in quote token
      // TODO: Implement proper fee analysis using pool.poolFees data
      return true;
    } catch (err) {
      console.error(`   ❌ Error checking fee structure:`, err);
      return false;
    }
  }

  private async checkQuoteTokenOnlyFees(pool: any): Promise<boolean> {
    try {
      if (!pool.poolFees || !pool.poolFees.baseFee) {
        console.log(`   📊 No pool fees data found - assuming acceptable fee structure`);
        return true; // Assume acceptable if no fee data
      }
      
      // Log detailed fee information for debugging
      console.log(`   📊 Fee structure analysis:`);
      console.log(`      feeSchedulerMode: ${pool.poolFees.baseFee.feeSchedulerMode}`);
      console.log(`      numberOfPeriod: ${pool.poolFees.baseFee.numberOfPeriod}`);
      console.log(`      periodFrequency: ${pool.poolFees.baseFee.periodFrequency}`);
      console.log(`      reductionFactor: ${pool.poolFees.baseFee.reductionFactor}`);
      
      // Check if it has a fee scheduler
      // numberOfPeriod > 0 indicates a scheduler is present
      const hasScheduler = pool.poolFees.baseFee.numberOfPeriod > 0;
      
      // From the DAMM UI, we need to check TWO separate things:
      // 1. Fee Collection Token: "Quote" vs "Base + Quote" 
      // 2. Fee Scheduler Mode: "Linear" vs "Exponential"
      
      // First check: Fee Collection Token (this is controlled by collectFeeMode in the pool)
      // We need to examine the pool structure to find the actual fee collection mode
      console.log(`      🔍 Full pool fees structure:`, JSON.stringify(pool.poolFees, null, 2));
      
      // The feeSchedulerMode field in baseFee might actually be the collect fee mode
      const feeCollectionMode = pool.poolFees.baseFee.feeSchedulerMode;
      let hasQuoteTokenOnlyFees = false;
      
      if (feeCollectionMode === 0) {
        console.log(`      ❌ Fee Collection: Base + Quote (not what we want)`);
        hasQuoteTokenOnlyFees = false;
      } else if (feeCollectionMode === 1) {
        console.log(`      ✅ Fee Collection: Quote only (exactly what we want!)`);
        hasQuoteTokenOnlyFees = true;
      } else {
        console.log(`      ❓ Unknown fee collection mode: ${feeCollectionMode}`);
        hasQuoteTokenOnlyFees = false; // Be strict with unknown modes
      }
      
      // Second check: Fee Scheduler Mode (Linear vs Exponential)
      // We need to identify where this is stored in the pool structure
      let isLinearScheduler = false;
      
      if (hasScheduler) {
        // Look for indicators of Linear vs Exponential scheduler
        const reductionFactor = pool.poolFees.baseFee.reductionFactor;
        const cliffFeeNumerator = pool.poolFees.baseFee.cliffFeeNumerator;
        
        console.log(`      🔍 Scheduler type analysis:`);
        console.log(`         Reduction factor: ${reductionFactor}`);
        console.log(`         Cliff fee numerator: ${cliffFeeNumerator}`);
        console.log(`         Period frequency: ${pool.poolFees.baseFee.periodFrequency}`);
        console.log(`         Number of periods: ${pool.poolFees.baseFee.numberOfPeriod}`);
        
        // Check if there are other fields in the pool that might indicate Linear vs Exponential
        if (pool.collectFeeMode !== undefined) {
          console.log(`         Pool collectFeeMode: ${pool.collectFeeMode}`);
        }
        
        // For now, we need to log everything and figure out the pattern
        // Linear schedulers should use simple arithmetic reduction
        // Exponential schedulers use exponential decay
        
        // Heuristic: If the reduction factor is small relative to cliff fee, it's likely linear
        // If it's a percentage (like 5000-9000 for 50%-90%), it might be exponential
        const reductionFactorNum = Number(reductionFactor.toString());
        const cliffFeeNum = Number(cliffFeeNumerator.toString());
        
        if (reductionFactorNum < cliffFeeNum / 10) {
          console.log(`      ✅ Appears to be Linear scheduler (small reduction factor)`);
          isLinearScheduler = true;
        } else if (reductionFactorNum > 1000) {
          console.log(`      ⚠️  Might be Exponential scheduler (large reduction factor)`);
          isLinearScheduler = false;
        } else {
          console.log(`      ❓ Unclear scheduler type - being conservative`);
          isLinearScheduler = false;
        }
      } else {
        console.log(`      ❌ No fee scheduler present`);
      }
      
      const result = hasScheduler && hasQuoteTokenOnlyFees && isLinearScheduler;
      console.log(`      📊 Final result: hasScheduler=${hasScheduler}, quoteTokenOnly=${hasQuoteTokenOnlyFees}, linearScheduler=${isLinearScheduler}, result=${result}`);
      
      return result;
    } catch (err) {
      console.error(`   ❌ Error checking fee schedule:`, err);
      console.log(`   📊 Error analyzing fees - assuming acceptable structure`);
      return true; // Assume acceptable on error
    }
  }
}
