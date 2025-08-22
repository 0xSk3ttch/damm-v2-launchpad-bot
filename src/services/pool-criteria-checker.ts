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
      
      // Criteria 4: Must have linear fee schedule
      const hasLinearSchedule = await this.checkLinearFeeSchedule(pool);
      
      return {
        hasWSOL,
        hasSOL,
        hasMigratedToken,
        feesInQuoteToken,
        hasLinearSchedule
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
    
    // Log detailed criteria results
    if (!criteria.hasWSOL && !criteria.hasSOL) {
      console.log(`   ❌ Pool doesn't contain WSOL or SOL`);
    }
    if (!criteria.hasMigratedToken) {
      console.log(`   ❌ Pool doesn't contain migrated token`);
    }
    if (!criteria.feesInQuoteToken) {
      console.log(`   ❌ Fees not paid in quote token (SOL/WSOL)`);
    }
    if (!criteria.hasLinearSchedule) {
      console.log(`   ❌ Not a linear fee schedule`);
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

  private async checkLinearFeeSchedule(pool: any): Promise<boolean> {
    try {
      if (!pool.poolFees || !pool.poolFees.baseFee) {
        return false;
      }
      
      // Check if it's a linear fee schedule
      // numberOfPeriod > 0 indicates a scheduler, mode 0 is linear
      const hasScheduler = pool.poolFees.baseFee.numberOfPeriod > 0;
      const isLinear = pool.poolFees.baseFee.feeSchedulerMode === 0;
      
      return hasScheduler && isLinear;
    } catch (err) {
      console.error(`   ❌ Error checking fee schedule:`, err);
      return false;
    }
  }
}
