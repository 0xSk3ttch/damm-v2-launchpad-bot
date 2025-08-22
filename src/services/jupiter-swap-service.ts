import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

export interface SwapOptions {
  inputMint: string; // SOL mint (Jupiter can handle native SOL)
  outputMint: string; // Token mint to buy
  amount: number; // Amount in SOL (e.g., 0.02)
  slippageBps: number; // Slippage tolerance in basis points (e.g., 2000 = 20%)
}

export class JupiterSwapService {
  private readonly connection: Connection;
  private readonly jupiterApiUrl = 'https://quote-api.jup.ag/v6';

  constructor(connection: Connection) {
    this.connection = connection;
  }

  // Check RPC performance and latency
  private async checkRpcPerformance(): Promise<void> {
    try {
      const startTime = Date.now();
      const slot = await this.connection.getSlot();
      const latency = Date.now() - startTime;
      
      console.log(`🔍 RPC Performance Check:`);
      console.log(`   Endpoint: ${this.connection.rpcEndpoint}`);
      console.log(`   Current Slot: ${slot}`);
      console.log(`   Latency: ${latency}ms`);
      
      if (latency > 5000) {
        console.log('⚠️  High RPC latency detected - this may cause timeouts');
      } else if (latency > 1000) {
        console.log('⚠️  Moderate RPC latency detected');
      } else {
        console.log('✅ RPC latency is good');
      }
    } catch (error: any) {
      console.log('⚠️  RPC performance check failed:', error.message);
    }
  }

  // Monitor a specific transaction with detailed tracking
  private async monitorTransaction(signature: string): Promise<void> {
    console.log(`🔍 Starting detailed transaction monitoring for: ${signature}`);
    
    let attempts = 0;
    const maxAttempts = 12; // Monitor for up to 60 seconds (12 * 5 seconds)
    
    while (attempts < maxAttempts) {
      try {
        const status = await this.connection.getSignatureStatus(signature);
        console.log(`   Attempt ${attempts + 1}/${maxAttempts} - Status: ${status.value?.confirmationStatus || 'unknown'}`);
        
        if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
          console.log(`✅ Transaction confirmed after ${attempts + 1} attempts (${(attempts + 1) * 5} seconds)`);
          return;
        }
        
        if (status.value?.err) {
          console.log(`❌ Transaction failed: ${JSON.stringify(status.value.err)}`);
          return;
        }
        
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between checks
        
      } catch (error: any) {
        console.log(`⚠️  Error monitoring transaction: ${error.message}`);
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    console.log(`⏰ Transaction monitoring timeout after ${maxAttempts * 5} seconds`);
  }

  async executeSwap(options: SwapOptions, wallet: any): Promise<string> {
    const maxRetries = 3;
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Starting Jupiter swap attempt ${attempt}/${maxRetries}: ${options.amount} SOL → ${options.outputMint}`);
        
        // Check if we already have the token in our wallet
        const walletHasToken = await this.checkWalletTokenBalance(options.outputMint, wallet);
        if (walletHasToken) {
          console.log(`✅ Wallet already contains ${options.outputMint}, skipping purchase`);
          return 'SKIPPED_ALREADY_OWNED';
        }

        // Check wallet SOL balance before attempting swap
        const walletPubkey = wallet.getPublicKey ? wallet.getPublicKey() : wallet.publicKey;
        const balance = await this.connection.getBalance(walletPubkey);
        const requiredLamports = Math.floor((options.amount + 0.01) * 1e9); // Add 0.01 SOL for fees
        
        if (balance < requiredLamports) {
          throw new Error(`Insufficient SOL balance. Required: ${(requiredLamports / 1e9).toFixed(3)} SOL, Available: ${(balance / 1e9).toFixed(3)} SOL`);
        }
        
        console.log(`💰 Wallet balance: ${(balance / 1e9).toFixed(3)} SOL, Required: ${(requiredLamports / 1e9).toFixed(3)} SOL`);

        // Check RPC performance before swap
        await this.checkRpcPerformance();
        
        // Execute Jupiter swap
        const swapResult = await this.executeSwapTransaction(options, wallet);
        
        console.log(`✅ Jupiter swap completed successfully!`);
        console.log(`   Transaction: ${swapResult}`);
        console.log(`   Amount: ${options.amount} SOL → ${options.outputMint}`);
        
        return swapResult;
        
      } catch (error: any) {
        lastError = error;
        console.error(`❌ Jupiter swap attempt ${attempt}/${maxRetries} failed:`, error.message);
        
        if (attempt < maxRetries) {
          console.log(`⏳ Waiting 5 seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          console.error(`❌ All ${maxRetries} swap attempts failed`);
          throw new Error(`Jupiter swap failed after ${maxRetries} attempts. Last error: ${error.message}`);
        }
      }
    }
    
    // This should never be reached, but TypeScript requires it
    throw lastError;
  }

  private async getQuote(options: SwapOptions): Promise<any> {
    try {
      const inputMint = new PublicKey(options.inputMint);
      const outputMint = new PublicKey(options.outputMint);
      const amount = Math.floor(options.amount * 1e9); // Convert SOL to lamports

      console.log(`🔍 Jupiter Quote Request:`);
      console.log(`   Input Mint: ${inputMint.toBase58()}`);
      console.log(`   Output Mint: ${outputMint.toBase58()}`);
      console.log(`   Amount: ${amount} lamports (${options.amount} SOL)`);
      console.log(`   Slippage: ${options.slippageBps} bps`);

      // Build query parameters as per working Jupiter v6 API
      const quoteUrl = `${this.jupiterApiUrl}/quote?inputMint=${inputMint.toBase58()}&outputMint=${outputMint.toBase58()}&amount=${amount}&slippageBps=${options.slippageBps}&onlyDirectRoutes=false&asLegacyTransaction=false`;
      
      console.log(`🔍 Quote URL: ${quoteUrl}`);

      const response = await fetch(quoteUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Jupiter API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const quoteData = await response.json();
      
      if (!quoteData.outAmount || quoteData.outAmount === '0') {
        throw new Error('Jupiter quote returned zero output amount - insufficient liquidity');
      }

      console.log(`📊 Quote received: ${quoteData.outAmount} output tokens`);
      console.log(`📊 Route: ${quoteData.routes?.[0]?.marketInfos?.[0]?.amm?.label || 'Unknown'}`);
      
      return quoteData;
      
    } catch (error: any) {
      console.error(`❌ Error getting quote:`, error);
      return null;
    }
  }

  // Check if wallet already has a token
  async checkWalletTokenBalance(tokenMint: string, wallet: any): Promise<boolean> {
    try {
      // Handle both WalletProvider and standard wallet objects
      const walletPubkey = wallet.getPublicKey ? wallet.getPublicKey() : wallet.publicKey;
      
      if (!walletPubkey) {
        console.error('❌ Invalid wallet object - no public key found');
        return false;
      }

      const mintPubkey = new PublicKey(tokenMint);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { mint: mintPubkey }
      );

      // Check if any account has a balance > 0
      for (const account of tokenAccounts.value) {
        const balance = account.account.data.parsed.info.tokenAmount.uiAmount;
        if (balance > 0) {
          console.log(`💰 Wallet already has ${balance} of ${tokenMint}`);
          return true;
        }
      }

      return false;
      
    } catch (error) {
      console.error(`❌ Error checking wallet token balance:`, error);
      return false;
    }
  }

  // Execute Jupiter swap with improved error handling and timeout recovery
  private async executeSwapTransaction(options: SwapOptions, wallet: any): Promise<string> {
    try {
      // Get quote first
      const quote = await this.getQuote(options);
      if (!quote) {
        throw new Error('Failed to get quote from Jupiter');
      }

      // Handle both WalletProvider and standard wallet objects
      const walletPubkey = wallet.getPublicKey ? wallet.getPublicKey() : wallet.publicKey;
      
      if (!walletPubkey) {
        throw new Error('Invalid wallet object - no public key found');
      }

      // Get swap instructions using Jupiter API
      const swapInstructionsUrl = `${this.jupiterApiUrl}/swap`;
      const swapRequest = {
        quoteResponse: quote,
        userPublicKey: walletPubkey.toBase58(),
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: 10000, // Add explicit priority fee for better success rate
      };

      console.log(`🔍 Getting swap instructions from: ${swapInstructionsUrl}`);

      const swapResponse = await fetch(swapInstructionsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(swapRequest),
      });

      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        throw new Error(`Jupiter swap API error: ${swapResponse.status} ${swapResponse.statusText} - ${errorText}`);
      }

      const swapData = await swapResponse.json();
      
      if (!swapData || !swapData.swapTransaction) {
        throw new Error('Failed to get swap instructions');
      }

      // Build and send the transaction
      const swapTransaction = swapData.swapTransaction;
      const transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
      
      // Get the keypair for signing
      const keypair = wallet.getKeypair ? wallet.getKeypair() : wallet;
      
      // Sign the versioned transaction
      transaction.sign([keypair]);
      
      // First simulate the transaction to catch errors early
      console.log('🔍 Simulating swap transaction...');
      const simulation = await this.connection.simulateTransaction(transaction);
      
      if (simulation.value.err) {
        console.log('❌ Swap simulation failed:', simulation.value.err);
        console.log('📋 Simulation logs:', simulation.value.logs);
        throw new Error('Swap simulation failed');
      }
      
      console.log('✅ Swap simulation successful, sending transaction...');
      
      // Send the transaction
      const signature = await this.connection.sendTransaction(transaction, {
        skipPreflight: false, // Keep preflight to catch errors early
        preflightCommitment: 'confirmed',
        maxRetries: 3, // Add retry logic
      });
      
      console.log(`📝 Swap transaction sent: ${signature}`);
      
      // Wait for confirmation with improved timeout handling and error recovery
      console.log('⏳ Waiting for transaction confirmation...');
      console.log(`   RPC Endpoint: ${this.connection.rpcEndpoint}`);
      console.log(`   Commitment Level: confirmed`);
      
      let confirmation;
      let txStatus;
      
      try {
        // Try to confirm the transaction
        console.log('   Attempting confirmation...');
        confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
          console.log('❌ Swap transaction failed:', confirmation.value.err);
          throw new Error('Swap transaction failed');
        }
        
        console.log(`✅ Swap successful! Transaction confirmed: ${signature}`);
        return signature;
        
      } catch (confirmError: any) {
        console.log('❌ Transaction confirmation failed, investigating...');
        console.log('   Error:', confirmError.message);
        
        // Start detailed transaction monitoring in parallel
        this.monitorTransaction(signature).catch(() => {
          // Monitoring failed, but don't let it affect the main flow
        });
        
        // Check if transaction actually succeeded despite confirmation error
        try {
          txStatus = await this.connection.getSignatureStatus(signature);
          console.log('   Transaction status:', txStatus.value?.confirmationStatus);
          
          if (txStatus.value?.confirmationStatus === 'confirmed' || txStatus.value?.confirmationStatus === 'finalized') {
            console.log('✅ Transaction actually succeeded despite confirmation error!');
            console.log('   Status:', txStatus.value.confirmationStatus);
            return signature;
          }
          
          // Check if transaction is still processing
          if (txStatus.value?.confirmationStatus === 'processed') {
            console.log('⏳ Transaction still processing, waiting longer...');
            
            // Wait a bit more and check again
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 more seconds
            
            txStatus = await this.connection.getSignatureStatus(signature);
            if (txStatus.value?.confirmationStatus === 'confirmed' || txStatus.value?.confirmationStatus === 'finalized') {
              console.log('✅ Transaction confirmed after extended wait!');
              return signature;
            }
          }
          
          // Check if transaction failed
          if (txStatus.value?.err) {
            console.log('❌ Transaction failed on-chain:', txStatus.value.err);
            throw new Error(`Transaction failed on-chain: ${JSON.stringify(txStatus.value.err)}`);
          }
          
          // If we get here, transaction is in an unknown state
          console.log('⚠️  Transaction status unknown, investigating further...');
          
          // Check recent transactions to see if ours went through
          const recentTxs = await this.connection.getSignaturesForAddress(walletPubkey, { limit: 5 });
          const ourTx = recentTxs.find(tx => tx.signature === signature);
          
          if (ourTx && ourTx.err === null) {
            console.log('✅ Transaction found in recent history and appears successful!');
            return signature;
          }
          
          // Try to get the transaction details directly
          try {
            console.log('🔍 Attempting to fetch transaction details directly...');
            const txDetails = await this.connection.getTransaction(signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0
            });
            
            if (txDetails && !txDetails.meta?.err) {
              console.log('✅ Transaction details fetched and appears successful!');
              return signature;
            } else if (txDetails?.meta?.err) {
              console.log('❌ Transaction details show failure:', txDetails.meta.err);
              throw new Error(`Transaction failed on-chain: ${JSON.stringify(txDetails.meta.err)}`);
            }
          } catch (fetchError: any) {
            console.log('⚠️  Failed to fetch transaction details:', fetchError.message);
          }
          
          throw new Error(`Transaction confirmation failed and status unclear. Signature: ${signature}`);
          
        } catch (statusError: any) {
          console.log('❌ Failed to check transaction status:', statusError.message);
          throw new Error(`Transaction confirmation failed and status check failed. Signature: ${signature}, Error: ${confirmError.message}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error executing swap transaction:`, error);
      throw error;
    }
  }
}
