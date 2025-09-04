import {ZapOut} from "./zap-out";
import {loadConfig} from "../../src/config/config";
import {Connection} from "@solana/web3.js";
import {WalletProvider} from "../../src/infra/wallet-provider";

async function main() {
    const cfg = loadConfig();
    const connection = new Connection(cfg.rpcEndpoint, {
        commitment: 'confirmed',
        wsEndpoint: cfg.wsEndpoint,
    });
    const wallet = WalletProvider.fromPrivateKey(cfg.privateKey);
    const discordWebhookUrl = cfg.discordWebhook;
    
    const zapOutOptions = {
        connection,
        wallet,
        discordWebhookUrl
    };
    
    const zapOut = new ZapOut(zapOutOptions);
    
    try {
        // Get all positions first
        console.log("🔍 Getting all DAMM positions...");
        const positions = await zapOut.getAllPositions();
        
        if (positions.length === 0) {
            console.log("No DAMM positions found in wallet");
            return;
        }
        
        console.log(`Found ${positions.length} positions`);
        
        // Test with just the first position first (safer approach)
        console.log("\n🧪 Testing with first position only...");
        const firstPosition = positions[0];
        console.log(`Testing position: ${firstPosition.poolAddress.toBase58()}`);
        console.log(`Token A: ${firstPosition.tokenAMint.toBase58()}`);
        console.log(`Token B: ${firstPosition.tokenBMint.toBase58()}`);
        console.log(`Unlocked Liquidity: ${firstPosition.unlockedLiquidity.toString()}`);
        
        // Ask user if they want to proceed
        console.log("\n⚠️  WARNING: This will remove liquidity from your position!");
        console.log("   Make sure you want to proceed before continuing.");
        console.log("   Press Ctrl+C to cancel, or wait 10 seconds to continue...");
        
        // Wait 10 seconds to give user time to cancel
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log("\n🚀 Proceeding with liquidity removal...");
        const signature = await zapOut.removeLiquidityFromPosition(firstPosition.poolAddress);
        console.log(`✅ Test successful! Signature: ${signature}`);
        
        console.log("\n📊 Summary:");
        console.log(`   Position: ${firstPosition.poolAddress.toBase58()}`);
        console.log(`   Transaction: ${signature}`);
        console.log(`   Status: Liquidity removed successfully`);
        console.log(`\n💡 Next steps:`);
        console.log(`   1. Check your wallet for the received tokens`);
        console.log(`   2. Use Jupiter or another DEX to convert tokens to SOL if desired`);
        console.log(`   3. Run this script again to process more positions`);
        
    } catch (error) {
        console.error("❌ Error in main:", error);
    }
}

main().catch(console.error);