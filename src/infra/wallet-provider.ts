import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

export class WalletProvider {
    private readonly kp: Keypair;

    private constructor(kp: Keypair) {
        this.kp = kp;
    }

    /** Preferred: load from PRIVATE_KEY in config/env (JSON array, base58, or hex). */
    static fromPrivateKey(secret: string): WalletProvider {
        if (!secret || !secret.trim()) {
            throw new Error('Missing PRIVATE_KEY');
        }

        const buf = parseSecretToBuffer(secret);
        // Buffer is a Uint8Array at runtime; TypeScript accepts it here.
        const kp = Keypair.fromSecretKey(buf);
        return new WalletProvider(kp);
    }

    static fromKeypairFile(filePath: string): WalletProvider {
        const p = resolve(filePath);
        const raw = readFileSync(p, 'utf8');
        const arr = JSON.parse(raw) as number[];
        if (!Array.isArray(arr) || arr.length !== 64) {
            throw new Error(`Invalid keypair JSON at ${p}: expected array[64]`);
        }
        const buf = Buffer.from(arr);
        const kp = Keypair.fromSecretKey(buf);
        return new WalletProvider(kp);
    }

    /** Convenience: try WALLET_KEYPAIR_PATH first, then PRIVATE_KEY. */
    static fromEnv(): WalletProvider {
        const file = process.env.WALLET_KEYPAIR_PATH;
        if (file) return WalletProvider.fromKeypairFile(file);

        const secret = process.env.PRIVATE_KEY;
        if (secret) return WalletProvider.fromPrivateKey(secret);

        throw new Error('Provide WALLET_KEYPAIR_PATH or PRIVATE_KEY');
    }

    getPublicKey(): PublicKey {
        return this.kp.publicKey;
    }

    getKeypair(): Keypair {
        return this.kp;
    }

    signTx(tx: VersionedTransaction): void {
        tx.sign([this.kp]);
    }
}

/** Accepts JSON array, base58 secret, hex secret, or 32-byte seed (hex/base58) */
function parseSecretToBuffer(input: string): Buffer {
    const s = input.trim();

    // 1) JSON array of 64 numbers (Phantom / solana-keygen export)
    if (s.startsWith('[')) {
        const arr = JSON.parse(s) as number[];
        if (!Array.isArray(arr) || (arr.length !== 64 && arr.length !== 32)) {
            throw new Error('PRIVATE_KEY JSON must be array of 64 (or 32) numbers');
        }
        return arr.length === 64 ? Buffer.from(arr) : seedToSecret(Buffer.from(arr));
    }

    // 2) base58 (commonly used in CI)
    if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(s) && s.length >= 40) {
        const bytes = bs58.decode(s);
        if (bytes.length === 64) return Buffer.from(bytes);
        if (bytes.length === 32) return seedToSecret(Buffer.from(bytes));
        throw new Error(`Base58 secret must be 32 or 64 bytes, got ${bytes.length}`);
    }

    // 3) hex (with or without 0x)
    const hex = s.startsWith('0x') ? s.slice(2) : s;
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
        const bytes = Buffer.from(hex, 'hex');
        if (bytes.length === 64) return bytes;
        if (bytes.length === 32) return seedToSecret(bytes);
        throw new Error(`Hex secret must be 32 or 64 bytes, got ${bytes.length}`);
    }

    throw new Error('PRIVATE_KEY format not recognized (expect JSON array, base58, or hex)');
}

/** Expand a 32-byte seed into a 64-byte ed25519 secret key using tweetnacl */
function seedToSecret(seed32: Buffer): Buffer {
    if (seed32.length !== 32) throw new Error('Seed must be 32 bytes');
    const pair = nacl.sign.keyPair.fromSeed(Uint8Array.from(seed32));
    return Buffer.from(pair.secretKey); // 64 bytes
}
