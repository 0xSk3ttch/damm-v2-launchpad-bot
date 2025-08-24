import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface Config {
    rpcEndpoint: string;
    wsEndpoint: string;
    privateKey: string;
    dammProgramId: string;
    pumpFunProgramId: string;
    raydiumAmmProgramId: string;
    solAmount: number; // Amount of SOL to use for liquidity (per side)
    slippageBps: number; // Slippage tolerance in basis points
    addLiquidity: boolean; // Whether to automatically add liquidity to matching pools
    discordWebhook: string;
}

export function loadConfig(): Config {
    require('dotenv').config();

    return {
        rpcEndpoint: process.env.RPC_HTTP || 'https://api.mainnet-beta.solana.com',
        wsEndpoint: process.env.RPC_WS || 'wss://api.mainnet-beta.solana.com',
        privateKey: process.env.PRIVATE_KEY || '',
        dammProgramId: process.env.DAMM_PROGRAM_ID || 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
        pumpFunProgramId: process.env.PUMPFUN_PROGRAM_ID || '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg',
        raydiumAmmProgramId: process.env.RAYDIUM_AMM_PROGRAM_ID || '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
        solAmount: parseFloat(process.env.SOL_AMOUNT || '0.002'), // Default to 0.002 SOL per side
        slippageBps: parseInt(process.env.SLIPPAGE_BPS || '2000'), // Default to 20% slippage
        addLiquidity: process.env.ADD_LIQUIDITY === 'true', // Default to false for safety
        discordWebhook: process.env.DISCORD_WEBHOOK || ''
    };
}
