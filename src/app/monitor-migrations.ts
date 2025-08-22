import { Connection, clusterApiUrl } from '@solana/web3.js';
import { RpcProvider } from '../infra/rpc-provider';
import { MigrationMonitor } from '../monitors/migration-monitor';
import { DammBot } from '../bot';
// import { Wallet } from '../wallet'; // not needed yet, but shown for future use

async function main() {
    // You can swap in Helius URL here:
    // const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
    const connection = new Connection(clusterApiUrl('mainnet-beta'), 'finalized');

    const bot = new DammBot(); // assuming your bot loads config (pumpFunProgramId)
    const pumpFunProgramId = bot.getConfig().pumpFunProgramId;

    const rpc = new RpcProvider(connection);

    const monitor = new MigrationMonitor(rpc, {
        pumpFunProgramId,
        onMigration: (evt) => {
            // For now, just log. Later, publish to lifecycle matcher / add to a queue.
            console.log('📨 MigrationEvent', evt);
        },
        ttlMs: 2 * 60 * 1000,
        commitment: 'finalized',
    });

    await monitor.start();

    // graceful shutdown
    process.on('SIGINT', async () => {
        await monitor.stop();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await monitor.stop();
        process.exit(0);
    });
}

void main();
