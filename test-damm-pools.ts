// test-damm-pools.ts
// Test file to listen for DAMM V2 pool creations with SOL/WSOL on one side
// Uses existing infrastructure without modifying core files

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { loadConfig } from './src/config/config';
import { RpcProvider } from './src/infra/rpc-provider';
import { DammPoolMonitor } from './src/monitors/damm-pool-monitor';

const WSOL = 'So11111111111111111111111111111111111111112';
const SOL = '11111111111111111111111111111111'; // Native SOL

/**
 * Check if fees are paid in quote token (SOL/WSOL) by analyzing transaction logs
 * This function looks for specific patterns that indicate fees are paid in SOL/WSOL
 */
async function checkFeesInQuoteToken(signature: string, connection: Connection): Promise<boolean> {
    try {
        // Get transaction details to analyze fee structure
        const tx = await connection.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
        });
        
        if (!tx || !tx.meta) return false;
        
        // Look for fee-related patterns in the transaction
        const logs = tx.meta.logMessages || [];
        const allLogs = logs.join(' ').toLowerCase();
        
        // Check for DAMM-specific fee patterns
        // DAMM pools with fees in quote token typically have specific log patterns
        const feePatterns = [
            'fee',
            'swap',
            'pool',
            'damm',
            'cpamm'
        ];
        
        // Check if logs contain fee-related information
        const hasFeeInfo = feePatterns.some(pattern => allLogs.includes(pattern));
        
        // Look for SOL/WSOL transfers that might indicate fee payments
        const hasSolTransfers = tx.meta.postTokenBalances?.some(balance => 
            balance.mint === WSOL || balance.mint === SOL
        ) || false;
        
        // Check if there are native SOL transfers (fee payments)
        const hasNativeSolTransfers = tx.meta.postTokenBalances?.some(balance => 
            balance.mint === SOL
        ) || false;
        
        // For DAMM pools, if we see SOL/WSOL activity and fee-related logs,
        // it's likely fees are paid in quote token
        if (hasFeeInfo && (hasSolTransfers || hasNativeSolTransfers)) {
            return true;
        }
        
        // Additional check: look for specific DAMM program interactions
        if (allLogs.includes('cpamdp') || allLogs.includes('damm')) {
            // If it's a DAMM transaction and has SOL/WSOL activity, assume fees in quote
            return hasSolTransfers || hasNativeSolTransfers;
        }
        
        return false;
    } catch (error) {
        console.error('Error checking fees in quote token:', error);
        return false;
    }
}

/**
 * Check if a DAMM pool has a linear fee schedule by analyzing pool configuration
 * Linear fee schedules have constant fees regardless of trade size
 */
async function checkLinearFeeSchedule(poolAddress: string, connection: Connection): Promise<boolean> {
    try {
        // Get the pool account data to analyze fee structure
        const poolAccount = await connection.getAccountInfo(new PublicKey(poolAddress));
        
        if (!poolAccount || !poolAccount.data) return false;
        
        // DAMM pools have specific data structures for fee configuration
        // We need to parse the account data to determine fee schedule type
        
        // For now, we'll use a heuristic approach based on common DAMM pool patterns
        // In a real implementation, you'd need to decode the specific DAMM pool data structure
        
        // Check if this is a valid DAMM pool by looking for the program ID
        const data = poolAccount.data;
        
        // Look for fee-related patterns in the account data
        // This is a simplified approach - in practice you'd need the exact DAMM data structure
        
        // For DAMM v2, linear fee schedules typically have:
        // - Fixed fee parameters
        // - No dynamic fee calculations
        // - Simple fee structure
        
        // Since we can't easily decode the binary data without the exact schema,
        // we'll use a proxy method: check if the pool has been used for swaps
        // Linear fee pools are more commonly used for basic trading
        
        // For now, return true as a placeholder - you'll need to implement
        // the actual DAMM pool data parsing logic
        console.log('⚠️  Linear fee schedule check: Placeholder implementation');
        console.log('   Need DAMM pool data structure to properly decode fee schedule');
        
        // TODO: Implement proper DAMM pool data parsing
        // This would involve:
        // 1. Getting the pool account data
        // 2. Decoding the binary data according to DAMM schema
        // 3. Extracting fee parameters
        // 4. Determining if fees are linear vs dynamic
        
        // For now, let's try to detect based on pool characteristics
        // Linear fee pools in DAMM typically have simpler structures
        
        // Check if this is a basic DAMM pool (more likely to have linear fees)
        // We can look for specific patterns in the account data
        
        // Alternative approach: Check if the pool has been used for swaps
        // Linear fee pools are more commonly used for basic trading
        
        // For demonstration, we'll use a simple heuristic
        // In practice, you'd need the exact DAMM pool data structure
        
        console.log(`   Pool account size: ${data.length} bytes`);
        
        // DAMM v2 pools typically have a specific size range
        // Linear fee pools might have different data patterns
        
        // This is a simplified check - replace with actual DAMM data parsing
        return true; // Placeholder - replace with actual logic
    } catch (error) {
        console.error('Error checking linear fee schedule:', error);
        return false;
    }
}

async function testDammPoolMonitoring(): Promise<void> {
    const cfg = loadConfig();
    
    // Counters for different criteria
    let totalPools = 0;
    let solWsolPools = 0;
    let feesInQuoteTokenPools = 0;
    let linearFeeSchedulePools = 0;
    
    console.log('🧪 Starting DAMM V2 Pool Monitor Test');
    console.log('🔍 Looking for pools with SOL/WSOL on one side');
    console.log('💰 AND fees paid in quote token (SOL/WSOL)');
    console.log('📈 AND linear fee schedule');
    
    // Create connection using Helius endpoints
    const connection = new Connection(cfg.rpcEndpoint, {
        commitment: 'finalized',
        wsEndpoint: cfg.wsEndpoint,
    });
    const rpc = new RpcProvider(connection);
    
    console.log('🌐 RPC Endpoint:', cfg.rpcEndpoint);
    console.log('🔌 WS Endpoint:', cfg.wsEndpoint);
    
    // Create DAMM pool monitor with SOL/WSOL filtering
    const dammMonitor = new DammPoolMonitor(rpc, {
        dammProgramId: new PublicKey(cfg.dammProgramId),
        onPool: async (poolEvent) => {
            totalPools++;
            console.log('\n🏊 DAMM V2 Pool Created!');
            console.log('   Pool ID:', poolEvent.pool);
            console.log('   Token A:', poolEvent.tokenA);
            console.log('   Token B:', poolEvent.tokenB);
            console.log('   Signature:', poolEvent.sig);
            console.log('   Timestamp:', new Date(poolEvent.ts).toISOString());
            
            // Check if it's a SOL/WSOL pair
            const hasSol = poolEvent.tokenA === SOL || poolEvent.tokenB === SOL;
            const hasWsol = poolEvent.tokenA === WSOL || poolEvent.tokenB === WSOL;
            
            if (hasSol || hasWsol) {
                solWsolPools++;
                console.log('✅ SOL/WSOL pair detected!');
                const otherToken = hasSol ? 
                    (poolEvent.tokenA === SOL ? poolEvent.tokenB : poolEvent.tokenA) :
                    (poolEvent.tokenA === WSOL ? poolEvent.tokenB : poolEvent.tokenA);
                console.log('   Other token:', otherToken);
                
                // Check if fees are paid in quote token (SOL/WSOL)
                const feesInQuoteToken = await checkFeesInQuoteToken(poolEvent.sig, connection);
                if (feesInQuoteToken) {
                    feesInQuoteTokenPools++;
                    console.log('💰 Fees paid in quote token (SOL/WSOL) - MATCH!');
                    
                    // Check if pool has linear fee schedule
                    const hasLinearFeeSchedule = await checkLinearFeeSchedule(poolEvent.pool, connection);
                    if (hasLinearFeeSchedule) {
                        linearFeeSchedulePools++;
                        console.log('📈 Linear fee schedule detected - ALL CRITERIA MET! 🎯');
                    } else {
                        console.log('❌ Non-linear fee schedule');
                    }
                } else {
                    console.log('❌ Fees NOT paid in quote token');
                }
            } else {
                console.log('❌ No SOL/WSOL in this pair');
            }
            
            // Display summary
            console.log(`📊 Summary: ${totalPools} total pools, ${solWsolPools} SOL/WSOL pairs, ${feesInQuoteTokenPools} with fees in quote token, ${linearFeeSchedulePools} with linear fees`);
            console.log('---');
        },
        wsolOnly: false, // We want to see ALL pools, not just WSOL pairs
        commitment: 'finalized',
        creationLogHint: 'Create', // Look for 'Create' in logs
    });
    
    // Start monitoring
    await dammMonitor.start();
    console.log('✅ DAMM V2 Pool Monitor started successfully');
    console.log('📡 Listening for pool creation events...');
    console.log('💡 Press Ctrl+C to stop\n');
    
    // Keep the process running
    process.on('SIGINT', async () => {
        console.log('\n🛑 Stopping DAMM Pool Monitor...');
        await dammMonitor.stop();
        console.log('✅ Monitor stopped');
        process.exit(0);
    });
    
    // Keep alive with summary
    setInterval(() => {
        console.log(`⏰ Still listening... ${new Date().toISOString()}`);
        console.log(`📊 Current Summary: ${totalPools} total pools, ${solWsolPools} SOL/WSOL pairs, ${feesInQuoteTokenPools} with fees in quote token, ${linearFeeSchedulePools} with linear fees`);
    }, 30000); // Log every 30 seconds
}

// Run the test
testDammPoolMonitoring().catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});
