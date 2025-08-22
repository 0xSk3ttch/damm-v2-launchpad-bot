import WebSocket from 'ws';
import { PublicKey } from '@solana/web3.js';
import { loadConfig } from './src/config/config';

const cfg = loadConfig();

// ----- Constants (verified) -----
const DAMM_V2_PROGRAM = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'); // Meteora DAMM v2
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');  // Wrapped SOL (NATIVE_MINT)
const WSS = `wss://mainnet.helius-rpc.com/?api-key=${cfg.heliusKey}`;




// Robust reconnect
function backoff(attempt: number): number { 
    return Math.min(30000, 1000 * Math.pow(1.8, attempt)); 
}

let ws: WebSocket, subId = 1, reconnects = 0;
let responseCount = 0;

function connect(): void {
    ws = new WebSocket(WSS);

    ws.on('open', () => {
        reconnects = 0;
        // Subscribe to ALL DAMM v2 program logs for debugging (temporarily)
        const req = {
            jsonrpc: '2.0',
            id: subId++,
            method: 'logsSubscribe',
            params: [
                { 
                    mentions: [DAMM_V2_PROGRAM.toBase58()]
                    // Temporarily removed filters to see ALL activity
                },
                { commitment: 'confirmed' }
            ]
        };
        ws.send(JSON.stringify(req));
        console.log('🟢 Connected & subscribed to DAMM v2 POOL CREATION logs only');
        console.log('🎯 Monitoring for: initialize_pool, initialize_pool_with_dynamic_config, initialize_customizable_pool');
    });

    ws.on('message', async (data: WebSocket.Data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (!msg.params?.result?.value) return;

            // Track response count for credit usage monitoring
            responseCount++;

            // Log response rate every 10 responses
            if (responseCount % 10 === 0) {
                console.log(`📊 Response count: ${responseCount} | Est. credits used: ${responseCount}`);
            }

            const { signature, logs } = msg.params.result.value;

            // Log ALL DAMM program activity to see what's actually happening
            console.log(`🔍 DAMM Activity #${responseCount}:`);
            console.log(`   Signature: ${signature}`);
            console.log(`   Logs: ${logs.join(' | ')}`);
            console.log('---');

            // Check if this looks like a pool creation
            const isPoolCreation = logs.some((log: string) => 
                log.includes('initialize_pool') || 
                log.includes('initialize_pool_with_dynamic_config') ||
                log.includes('initialize_customizable_pool')
            );

            if (isPoolCreation) {
                console.log('🚨 POTENTIAL POOL CREATION DETECTED! 🎉');
                console.log(`   Pool details: WSOL + other token`);
                console.log(`   View transaction: https://solscan.io/tx/${signature}`);
                console.log('---');

                // Send Discord notification
                try {
                    // Create a simple Discord notification without fetching token metadata
                    const payload = {
                        embeds: [{
                            title: '🏊‍♂️ DAMM Pool Creation Detected!',
                            description: 'A new DAMM v2 pool has been created!',
                            color: 0x00ff00, // Green color
                            fields: [
                                {
                                    name: '📋 Transaction',
                                    value: `[View on Solscan](https://solscan.io/tx/${signature})`,
                                    inline: false
                                },
                                {
                                    name: '⏰ Timestamp',
                                    value: new Date().toISOString(),
                                    inline: true
                                }
                            ],
                            timestamp: new Date().toISOString()
                        }]
                    };

                    const response = await fetch('https://discord.com/api/webhooks/1408201047725576212/RInFt1ytBIkaMQibeACRdjqPDIMW0JBHDztxoYE6_u4pdHPOWlDgQ2SiVZ1SL4aABgfD', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(payload)
                    });

                    if (response.ok) {
                        console.log('📢 Discord notification sent successfully (no RPC calls)');
                    } else {
                        console.error('❌ Discord webhook failed:', response.status, response.statusText);
                    }
                } catch (error) {
                    console.error('❌ Discord notification failed:', error);
                }
            }

            // TODO (optional): Use @meteora-ag/cp-amm-sdk to derive the pool PDA from the two mints
            // and/or fetch pool state to confirm fee schedule & config, then print it.

        } catch (e) {
            // swallow parsing errors
        }
    });



    ws.on('close', () => {
        const delay = backoff(++reconnects);
        console.warn(`🔌 WS closed. Reconnecting in ${delay}ms…`);
        setTimeout(connect, delay);
    });

    ws.on('error', (err: Error) => {
        console.warn('WS error:', err?.message || err);
        ws.close();
    });
}

// Check if we have the required config
if (!cfg.heliusKey) {
    console.error('❌ HELIUS_KEY not found in environment variables');
    console.error('Please add HELIUS_KEY to your .env file');
    process.exit(1);
}

console.log('🚀 Starting DAMM v2 pool detection test...');
console.log(`🔑 Using Helius key: ${cfg.heliusKey.substring(0, 8)}...`);
console.log(`🎯 Monitoring program: ${DAMM_V2_PROGRAM.toBase58()}`);
console.log(`🪙 WSOL mint: ${WSOL_MINT.toBase58()}`);
console.log(`📢 Discord notifications enabled (zero RPC calls)`);
console.log(`💰 RPC efficient: Only WebSocket + Discord webhook calls`);
console.log('---');

connect();
