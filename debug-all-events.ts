// Debug script to log ALL migrations and ALL pools without any filtering
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { loadConfig } from './src/config/config';
import { RpcProvider } from './src/infra/rpc-provider';
import { MigrationMonitor } from './src/monitors/migration-monitor';
import { DammPoolMonitor } from './src/monitors/damm-pool-monitor';

async function debugAll(): Promise<void> {
    const cfg = loadConfig();
    const connection = new Connection(cfg.rpcEndpoint, {
        commitment: 'finalized',
        wsEndpoint: cfg.wsEndpoint,
    });
    const rpc = new RpcProvider(connection);

    console.log('🔍 DEBUG MODE: Logging ALL migrations and ALL pools');
    console.log('==========================================');

    // Basic migration monitor - log everything
    const migration = new MigrationMonitor(rpc, {
        pumpFunProgramId: new PublicKey(cfg.pumpFunProgramId),
        onMigration: (evt) => {
            console.log('🎓 RAW MIGRATION:', JSON.stringify(evt, null, 2));
        },
        ttlMs: 60 * 60 * 1000, // 1 hour - very long to avoid deduplication
        commitment: 'finalized',
    });

    // Basic pool monitor - log everything, no filtering
    const damm = new DammPoolMonitor(rpc, {
        dammProgramId: new PublicKey(cfg.dammProgramId),
        onPool: (evt) => {
            console.log('🏊 RAW POOL:', JSON.stringify(evt, null, 2));
        },
        wsolOnly: false, // Don't filter for WSOL
        commitment: 'finalized',
        // Remove all filtering
    });

    await migration.start();
    await damm.start();

    console.log('👀 Watching for ALL events...');

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

debugAll().catch(console.error);
