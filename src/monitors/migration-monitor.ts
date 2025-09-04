import {
    Commitment,
    Logs,
    LogsCallback,
    PublicKey,
} from '@solana/web3.js';
import { RpcProvider } from '../infra/rpc-provider';
import { MigrationEvent } from '../domain/types';

type OnMigration = (event: MigrationEvent) => void;

export interface MigrationMonitorOptions {
    pumpFunProgramId: PublicKey;
    onMigration: OnMigration;
    ttlMs?: number;                 // de-dupe TTL window for mints/sigs
    commitment?: Commitment;        // default 'finalized'
    hints?: string[];               // optional log substrings to match
}

export class MigrationMonitor {
    private readonly rpc: RpcProvider;
    private readonly programId: PublicKey;
    private readonly onMigration: OnMigration;
    private readonly commitment: Commitment;
    private readonly ttlMs: number;
    private readonly hints: string[];

    private logsSubId: number | null = null;

    // de-dupe
    private readonly seenSigs = new Map<string, number>();  // sig -> expiryMs
    private readonly seenMints = new Map<string, number>(); // mint -> expiryMs
    private readonly sweeper: NodeJS.Timeout;

    constructor(rpc: RpcProvider, opts: MigrationMonitorOptions) {
        this.rpc = rpc;
        this.programId = opts.pumpFunProgramId;
        this.onMigration = opts.onMigration;
        this.commitment = opts.commitment ?? 'finalized';
        this.ttlMs = opts.ttlMs ?? 2 * 60 * 1000;
        this.hints = (opts.hints && opts.hints.length > 0)
            ? opts.hints
            : ['migrat', 'graduat', 'launch', 'create', 'pool'];
        this.sweeper = setInterval(() => this.sweep(), Math.min(Math.max(this.ttlMs / 3, 5_000), 60_000));
    }

    async start(): Promise<void> {
        await this.stop();
        const conn = this.rpc.getConnection();

        const cb: LogsCallback = async (logs: Logs) => {
            try {
                const joined = (logs.logs ?? []).join(' ').toLowerCase();
                if (!this.hints.some((h) => joined.includes(h))) return;

                const sig = logs.signature;
                if (this.isSigSeen(sig)) return;

                const ts = Date.now();
                const slot = 0;

                // Check if this is a real migration by looking for "Instruction: Migrate"
                const allLogs = (logs.logs ?? []).join(' ');
                if (!allLogs.includes('Instruction: Migrate')) {
                    this.markSig(sig, ts);
                    return;
                }
                
                const mint = await this.extractMintFromTransaction(sig);
                if (!mint) {
                    console.log('Could not extract token mint from migration transaction');
                    this.markSig(sig, ts);
                    return;
                }

                if (this.isMintSeen(mint)) {
                    this.markSig(sig, ts);
                    return;
                }

                this.markSig(sig, ts);
                this.markMint(mint, ts);

                this.onMigration({ mint, ts, sig, slot });
                console.log('Migration detected (WS only):', { mint, sig });
            } catch (e) {
                // keep this shit going
                console.error('Pump.fun WS log handler error:', e);
            }
        };

        this.logsSubId = conn.onLogs(this.programId, cb, this.commitment);
    }

    async stop(): Promise<void> {
        if (this.logsSubId !== null) {
            try {
                await this.rpc.getConnection().removeOnLogsListener(this.logsSubId);
            } catch {}
            this.logsSubId = null;
            console.log('Unsubscribed from Pump.fun logs');
        }
        clearInterval(this.sweeper);
    }

    private async extractMintFromTransaction(signature: string): Promise<string | undefined> {
        try {
            const conn = this.rpc.getConnection();
            const tx = await conn.getTransaction(signature, {
                commitment: this.commitment as any,
                maxSupportedTransactionVersion: 0
            });
            
            if (!tx || !tx.meta || !tx.meta.postTokenBalances) {
                console.log('No transaction data or postTokenBalances found');
                return undefined;
            }
            
            const WSOL = 'So11111111111111111111111111111111111111112';
            const postBalances = tx.meta.postTokenBalances;

            const migratedTokens = postBalances.filter(balance => 
                balance.mint !== WSOL && 
                balance.uiTokenAmount.uiAmount !== null &&
                balance.uiTokenAmount.uiAmount > 0
            );
            
            if (migratedTokens.length === 0) {
                console.log('No migrated tokens found in postTokenBalances');
                return undefined;
            }
            
            const migratedToken = migratedTokens[0];
            console.log(`Found migrated token: ${migratedToken.mint}`);
            console.log(`Amount: ${migratedToken.uiTokenAmount.uiAmountString} ${migratedToken.uiTokenAmount.decimals} decimals`);
            
            return migratedToken.mint;
            
        } catch (error) {
            console.error('Error extracting token mint from transaction:', error);
            return undefined;
        }
    }

    private isSigSeen(sig: string): boolean {
        const exp = this.seenSigs.get(sig);
        return typeof exp === 'number' && exp > Date.now();
    }

    private isMintSeen(mint: string): boolean {
        const exp = this.seenMints.get(mint);
        return typeof exp === 'number' && exp > Date.now();
    }

    private markSig(sig: string, now: number): void {
        this.seenSigs.set(sig, now + this.ttlMs);
    }

    private markMint(mint: string, now: number): void {
        this.seenMints.set(mint, now + this.ttlMs);
    }

    private sweep(): void {
        const now = Date.now();
        for (const [k, exp] of this.seenSigs) if (exp <= now) this.seenSigs.delete(k);
        for (const [k, exp] of this.seenMints) if (exp <= now) this.seenMints.delete(k);
    }
}
