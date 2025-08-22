// Debug script to track migration detection and pool detection in real-time
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { loadConfig } from './src/config/config';
import { RpcProvider } from './src/infra/rpc-provider';
import { MigrationMonitor } from './src/monitors/migration-monitor';
import { DammPoolMonitorEnhanced } from './src/monitors/damm-pool-monitor-enhanced';

async function debugMigrationPoolMatching(): Promise<void> {
    const cfg = loadConfig();
    const connection = new Connection(cfg.rpcEndpoint, {
        commitment: 'finalized',
        wsEndpoint: cfg.wsEndpoint,
    });
    const rpc = new RpcProvider(connection);

    console.log('🔍 DEBUG: Migration + Pool Matching Analysis');
    console.log('==========================================');
    console.log('🎯 Target token: 3W1Zp39AMoKWd5BxoTXMeABX3YUpVjnJ6Neo1S4spump');
    console.log('🏊 Expected pool: C9jWR5T1hD6LNFWZf7N7KHHEpVoU8zyo34stNqZZBtLF');
    console.log('---');

    // Track pending migrations
    const pendingMigrations = new Set<string>();
    
    // Migration monitor with detailed logging
    const migration = new MigrationMonitor(rpc, {
        pumpFunProgramId: new PublicKey(cfg.pumpFunProgramId),
        onMigration: (evt) => {
            console.log('🎓 MIGRATION DETECTED:', evt.mint);
            console.log(`   Pool: ${evt.sig}`);
            console.log(`   Timestamp: ${new Date(evt.ts).toISOString()}`);
            pendingMigrations.add(evt.mint);
            console.log(`   📊 Pending migrations: ${Array.from(pendingMigrations).join(', ')}`);
            console.log('---');
        },
        ttlMs: 60 * 60 * 1000, // 1 hour for debugging
        commitment: 'finalized',
    });

    // Enhanced DAMM monitor with detailed logging
    const damm = new DammPoolMonitorEnhanced(rpc, {
        dammProgramId: new PublicKey(cfg.dammProgramId),
        onPool: (evt) => {
            console.log('🏊 DAMM POOL DETECTED:', evt.pool);
            console.log(`   Token A: ${evt.tokenA}`);
            console.log(`   Token B: ${evt.tokenB}`);
            console.log(`   Timestamp: ${new Date(evt.ts).toISOString()}`);
            
            // Check if this pool matches any pending migrations
            const nonWsol = evt.tokenA === 'So11111111111111111111111111111111111111112' ? evt.tokenB : evt.tokenA;
            console.log(`   Non-WSOL token: ${nonWsol}`);
            
            if (pendingMigrations.has(nonWsol)) {
                console.log('🎉 MATCH FOUND! Pool matches pending migration!');
                console.log(`   Migration token: ${nonWsol}`);
                console.log(`   Pool: ${evt.pool}`);
                console.log('🎊 PARTY TIME! 🎊');
            } else {
                console.log('❌ No pending migration found for this token');
                console.log(`   Pending migrations: ${Array.from(pendingMigrations).join(', ')}`);
            }
            console.log('---');
        },
        wsolOnly: false, // Don't filter for WSOL to see all pools
        commitment: 'finalized',
        checkFeesInQuoteToken: false, // Disable for debugging
        checkLinearFeeSchedule: false, // Disable for debugging
    });

    await migration.start();
    await damm.start();

    console.log('👀 Monitoring for migrations and pools...');
    console.log('⏰ Waiting for events...');

    // Graceful shutdown
    const shutdown = async () => {
        console.log('🛑 Debug shutdown...');
        await migration.stop();
        await damm.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

debugMigrationPoolMatching().catch(console.error);
