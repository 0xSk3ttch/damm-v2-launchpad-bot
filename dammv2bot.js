import { Connection, PublicKey } from "@solana/web3.js";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";

const endpoint =
  "https://delicate-blue-dew.solana-mainnet.quiknode.pro/916e13354c0e5487bff2c2a0bbef192f297855bf/";
const programId = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const tokenCA = new PublicKey("GDGgJ151gXyNghcB5xxqH1L9GbALrD9SpjHQ2Z16pump");

const POOL_ACCOUNT_SIZE = 1112;
const TOKEN_OFFSET = 168;
const DELAY_MS = 10000; // 10 seconds

// Set to keep track of already seen pools
const seenPools = new Set();

async function checkPools(connection, cpAmm) {
  try {
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        { dataSize: POOL_ACCOUNT_SIZE },
        { memcmp: { offset: TOKEN_OFFSET, bytes: tokenCA.toBase58() } },
      ],
    });

    console.log(`Found ${accounts.length} candidate pool(s) containing your token.`);

    for (const { pubkey } of accounts) {
      if (seenPools.has(pubkey.toBase58())) continue; // skip already seen pools

      try {
        const pool = await cpAmm.fetchPoolState(pubkey);

        // Convert cliffFeeNumerator to human-friendly %
        let feePercent = 0;
        if (pool.poolFees && pool.poolFees.baseFee && pool.poolFees.baseFee.cliffFeeNumerator) {
          const cliffFeeNumerator = parseInt(pool.poolFees.baseFee.cliffFeeNumerator, 16);
          feePercent = (cliffFeeNumerator / 2 ** 32) * 100; // approximate %
        }

        // Determine scheduler based on numberOfPeriod
        let scheduler = "No scheduler";
        if (pool.poolFees && pool.poolFees.baseFee && pool.poolFees.baseFee.numberOfPeriod > 0) {
          scheduler = pool.poolFees.baseFee.feeSchedulerMode === 0 ? "Linear" : "Exponential";
        }

        // Determine fee type
        const tokenA = pool.tokenAMint.toString();
        const tokenB = pool.tokenBMint.toString();
        const tokenCAString = tokenCA.toString();

        let feeType = "Unknown";
        if (tokenA === tokenCAString && tokenB === tokenCAString) {
          feeType = "Mint + Quote fee";
        } else if (tokenA === tokenCAString || tokenB === tokenCAString) {
          feeType = "Quote-only fee";
        }

        // Log pool info
        console.log(
          `New Pool Detected: ${pubkey.toBase58()}\n` +
          `  tokenAMint: ${tokenA}\n` +
          `  tokenBMint: ${tokenB}\n` +
          `  Fee Percent: ${feePercent.toFixed(2)}%\n` +
          `  Scheduler: ${scheduler}\n` +
          `  Fee Type: ${feeType}\n`
        );

        seenPools.add(pubkey.toBase58()); // mark as seen

      } catch (err) {
        console.error(`Error fetching pool ${pubkey.toBase58()}:`, err);
      }
    }
  } catch (err) {
    console.error("Error fetching program accounts:", err);
  }
}

async function monitorPools() {
  const connection = new Connection(endpoint, "confirmed");
  const cpAmm = new CpAmm(connection);

  console.log(
    "Connected to Solana node, version:",
    (await connection.getVersion())["solana-core"]
  );

  while (true) {
    console.log("\nChecking pools at", new Date().toLocaleTimeString());
    await checkPools(connection, cpAmm);
    console.log(`Waiting ${DELAY_MS / 1000} seconds before next check...\n`);
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
}

monitorPools().catch(console.error);
