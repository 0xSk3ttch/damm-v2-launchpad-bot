// src/domain/types.ts
export interface MigrationEvent {
    mint: string;       // base58 mint that migrated
    ts: number;         // ms since epoch
    sig?: string;       // optional tx signature
    slot?: number;      // optional slot (handy for ordering/debug)
}

export interface PoolEvent {
    pool: string;       // pool account pubkey
    tokenA: string;     // mint A
    tokenB: string;     // mint B
    slot: number;
    sig: string;        // '' if not known
    ts: number;         // ms since epoch (first seen)
    source: 'damm-v2';
}

export interface MatchEvent {
    mint: string;
    pool: string;
    ts: number;         // ms since epoch
}
