import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { Connection } from "@solana/web3.js";
async function main() {
    const connection = new Connection("https://mainnet.helius-rpc.com/?api-key=94bb0f35-d90d-44f7-99c2-d581e4e88143");
    const cpAmm = new CpAmm(connection);

    const pools = await cpAmm.getAllPools();
    console.log(pools);
}

main().catch(console.error);