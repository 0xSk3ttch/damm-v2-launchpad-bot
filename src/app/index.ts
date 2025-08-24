// src/app/index.ts
import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { loadConfig } from '../config/config';
import { RpcProvider } from '../infra/rpc-provider';
import { WalletProvider } from '../infra/wallet-provider';
import { MigrationMonitor } from '../monitors/migration-monitor';
import { DammPoolMonitor } from '../monitors/damm-pool-monitor';
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
    const walletAddress = wallet.getPublicKey().toBase58();
    
    // Display wallet info prominently
    console.log('🔐 ========================================');
    console.log('🔐 BOT WALLET CONFIGURATION');
    console.log('🔐 ========================================');
    console.log(`🔑 Wallet Address: ${walletAddress}`);
    console.log(`🔑 Wallet (short): ${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`);
    console.log(`💰 Swap Amount: ${cfg.solAmount * 2} SOL per token (${cfg.solAmount} per side)`);
    console.log('🔐 ========================================');
    console.log('');

    // --- Services ---
    const discord = new DiscordNotifier('https://discord.com/api/webhooks/1408201047725576212/RInFt1ytBIkaMQibeACRdjqPDIMW0JBHDztxoYE6_u4pdHPOWlDgQ2SiVZ1SL4aABgfD');
    
    // --- DAMM Pool Monitor ---
    const dammMonitor = new DammPoolMonitor({
        connection,
        checkIntervalMs: 20000, // 20 seconds
        discordWebhookUrl: 'https://discord.com/api/webhooks/1408201047725576212/RInFt1ytBIkaMQibeACRdjqPDIMW0JBHDztxoYE6_u4pdHPOWlDgQ2SiVZ1SL4aABgfD',
        wallet,
        swapAmountSol: cfg.solAmount, // Use configured SOL amount per token
        addLiquidity: cfg.addLiquidity // Use configured value for liquidity addition
    });

    // --- Migration Monitor ---
    const migration = new MigrationMonitor(rpc, {
        pumpFunProgramId: new PublicKey(cfg.pumpFunProgramId),
        onMigration: async (evt): Promise<void> => {
            const now = Date.now();
            
            console.log('🎓 Migration detected! Adding to DAMM bot pending list...');
            console.log(`   Token: ${evt.mint}`);
            console.log(`   Timestamp: ${new Date(now).toISOString()}`);
            console.log(`   ⏰ Will watch for DAMM pools for 7 minutes`);
            console.log('---');
            
            // Add token to DAMM monitor's pending list
            dammMonitor.addMigratedToken(evt.mint);
            
            // Send Discord notification for migration detected
            try {
                await discord.sendMigrationAlert(evt.mint, evt.sig || 'Unknown', connection);
            } catch (error) {
                console.error('❌ Discord migration notification failed:', error);
            }
        },
        ttlMs: 5 * 60 * 1000, // 5 min de-dupe window
        commitment: 'finalized',
    });

    // --- Start up ---
    await migration.start();
    await dammMonitor.start();

    console.log('✅ Migration monitor running.');
    console.log('✅ DAMM pool monitor running.');
    console.log('📢 Discord notifications enabled (with proper token names)');
    console.log('🎯 Workflow: Migration Detection → Discord Alert → Add to DAMM Monitor → Pool Monitoring → Auto Token Purchase → Auto Liquidity Addition');
    console.log('⏰ Migration tokens are watched for DAMM pools for 7 minutes');
    console.log(`💰 Automatic token purchase: ${cfg.solAmount * 2} SOL per matching pool`);
    console.log(`🏊 Automatic liquidity addition: ${cfg.solAmount * 2} SOL equivalent (${cfg.solAmount} SOL + ${cfg.solAmount} tokens)`);
    console.log(`🔑 Bot Wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`);
    console.log('🔥 this is a firehose');

    // --- Graceful shutdown ---
    const shutdown = async (): Promise<void> => {
        console.log('🛑 Shutting down…');
        await migration.stop();
        await dammMonitor.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
});
