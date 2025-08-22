// src/app/index.ts
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { loadConfig } from '../config/config';
import { RpcProvider } from '../infra/rpc-provider';
import { WalletProvider } from '../infra/wallet-provider';
import { MigrationMonitor } from '../monitors/migration-monitor';
import { DiscordNotifier } from '../services/discord-notifier';



async function main(): Promise<void> {
    const cfg = loadConfig();

    // --- RPC / Wallet ---
    const connection = new Connection(cfg.rpcEndpoint, {
        commitment: 'finalized',
        wsEndpoint: cfg.wsEndpoint,
    });
    const rpc = new RpcProvider(connection);
    const wallet = WalletProvider.fromPrivateKey(cfg.privateKey);
    console.log('🔑 Wallet:', wallet.getPublicKey().toBase58());

    // No pool monitoring for now - starting fresh

    // --- Services ---

    // Discord notification service
    const discord = new DiscordNotifier('https://discord.com/api/webhooks/1408201047725576212/RInFt1ytBIkaMQibeACRdjqPDIMW0JBHDztxoYE6_u4pdHPOWlDgQ2SiVZ1SL4aABgfD');
    
    // Simple migration tracking (no pool matching for now)
    const migrations = new Set<string>();
    const migrationTimestamps = new Map<string, number>();

    // Pump.fun migration monitor - simple tracking only
    const migration = new MigrationMonitor(rpc, {
        pumpFunProgramId: new PublicKey(cfg.pumpFunProgramId),
        onMigration: async (evt): Promise<void> => {
            const now = Date.now();
            const expiry = now + (5 * 60 * 1000); // 5 minutes
            
            migrations.add(evt.mint);
            migrationTimestamps.set(evt.mint, expiry);
            
            console.log('🎓 Migration detected! Adding to 5-minute watchlist...');
            console.log(`   Token: ${evt.mint}`);
            console.log(`   Timestamp: ${new Date(now).toISOString()}`);
            console.log(`   ⏰ Will watch until ${new Date(expiry).toISOString()}`);
            console.log(`   📊 Total migrations watching: ${migrations.size}`);
            console.log('---');
            
            // Send Discord notification with proper metadata
            try {
                await discord.sendMigrationAlert(
                    evt.mint,
                    evt.sig || 'Unknown',
                    connection
                );
            } catch (error) {
                console.error('❌ Discord notification failed:', error);
            }
        },
        ttlMs: 5 * 60 * 1000, // 5 min de-dupe window
        commitment: 'finalized',
    });

    // No DAMM pool monitoring for now - starting fresh

    // --- Start up ---
    await migration.start();

    console.log('✅ Migration monitor running.');
    console.log('📢 Discord notifications enabled (with proper token names)');
    console.log('🎯 Workflow: Migration Detection → Discord Alert → 5-minute Watchlist');
    console.log('⏰ Migration tokens are watched for 5 minutes');
    console.log('🔥 this is a firehose');

    // --- Graceful shutdown ---
    const shutdown = async (): Promise<void> => {
        console.log('🛑 Shutting down…');
        await migration.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
});
