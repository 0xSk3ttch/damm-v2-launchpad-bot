import {
    Connection,
    PublicKey,
    VersionedTransactionResponse,
    TransactionResponse,
    Finality,
} from '@solana/web3.js';

export class RpcProvider {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    getConnection(): Connection {
        return this.connection;
    }

    onProgramLogs(
        programId: PublicKey,
        cb: (entry: { signature: string; logs?: string[] }) => void | Promise<void>,
        commitment: Finality = 'finalized'
    ): number {
        // returns a numeric subscription id
        return this.connection.onLogs(
            programId,
            async (entry) => {
                try {
                    await cb({ signature: entry.signature, logs: entry.logs ?? [] });
                } catch (e) {
                    // Do not throw inside WS callback; just log.
                    console.error('onProgramLogs callback error:', e);
                }
            },
            commitment
        );
    }

    async removeListener(subId: number): Promise<void> {
        try {
            await this.connection.removeOnLogsListener(subId);
        } catch {
            /* ignore */
        }
    }

    async getTransaction(
        signature: string,
        commitment: Finality = 'finalized'
    ): Promise<VersionedTransactionResponse | TransactionResponse | null> {
        // NOTE: This returns a union of versioned or legacy tx responses.
        return this.connection.getTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment, // expects Finality
        });
    }

    async getBlockTime(slot: number): Promise<number | null> {
        try {
            return await this.connection.getBlockTime(slot);
        } catch {
            return null;
        }
    }
}
