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
      
      console.log(`RPC Performance Check:`);
      console.log(`Endpoint: ${this.connection.rpcEndpoint}`);
      console.log(`Current Slot: ${slot}`);
      console.log(`Latency: ${latency}ms`);
      
      if (latency > 5000) {
        console.log('⚠High RPC latency detected - this may cause timeouts');
      } else if (latency > 1000) {
        console.log('Moderate RPC latency detected');
      } else {
        console.log('RPC latency is good');
      }
    } catch (error: any) {
      console.log('⚠RPC performance check failed:', error.message);
    }
  }

  // Check network health and congestion
  private async checkNetworkHealth(): Promise<void> {
    try {
      console.log('Network Health Check:');
      
      // Get recent block production rate
      const recentSlots = await this.connection.getRecentPerformanceSamples(4);
      if (recentSlots.length > 0) {
        const avgSlotTime = recentSlots.reduce((sum, sample) => sum + (sample.numTransactions || 0), 0) / recentSlots.length;
        console.log(`   Average transactions per slot: ${avgSlotTime.toFixed(0)}`);
        
        if (avgSlotTime < 1000) { // Low transaction count may indicate congestion
          console.log('Network appears congested, transactions may take longer');
        } else {
          console.log('Network appears healthy');
        }
      }
      
      // Check recent transaction success rate
      try {
        const recentBlocks = await this.connection.getBlocks(
          await this.connection.getSlot() - 10,
          await this.connection.getSlot()
        );
        console.log(`Recent blocks: ${recentBlocks.length} blocks in last 10 slots`);
      } catch (error) {
        console.log('Recent blocks: Unable to fetch (this is normal)');
      }
      
    } catch (error: any) {
      console.log('Network health check failed:', error.message);
    }
  }



  async executeSwap(options: SwapOptions, wallet: any): Promise<string> {
    const maxRetries = 3;
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Starting Jupiter swap attempt ${attempt}/${maxRetries}: ${options.amount} SOL → ${options.outputMint}`);
        
        // Check if we already have the token in our wallet
        const walletHasToken = await this.checkWalletTokenBalance(options.outputMint, wallet);
        if (walletHasToken) {
          console.log(`Wallet already contains ${options.outputMint}, skipping purchase`);
          return 'SKIPPED_ALREADY_OWNED';
        }

        // Check wallet SOL balance before attempting swap
        const walletPubkey = wallet.getPublicKey ? wallet.getPublicKey() : wallet.publicKey;
        const balance = await this.connection.getBalance(walletPubkey);
        const requiredLamports = Math.floor((options.amount + 0.01) * 1e9); // Add 0.01 SOL for fees
        
        if (balance < requiredLamports) {
          throw new Error(`Insufficient SOL balance. Required: ${(requiredLamports / 1e9).toFixed(3)} SOL, Available: ${(balance / 1e9).toFixed(3)} SOL`);
        }
        
        console.log(`Wallet balance: ${(balance / 1e9).toFixed(3)} SOL, Required: ${(requiredLamports / 1e9).toFixed(3)} SOL`);

        // Check RPC performance before swap
        await this.checkRpcPerformance();
        
        // Check network health before swap
        await this.checkNetworkHealth();
        
        // Execute Jupiter swap
        const swapResult = await this.executeSwapTransaction(options, wallet);
        
        console.log(`Jupiter swap completed successfully!`);
        console.log(`Transaction: ${swapResult}`);
        console.log(`Amount: ${options.amount} SOL → ${options.outputMint}`);
        
        return swapResult;
        
      } catch (error: any) {
        lastError = error;
        console.error(`Jupiter swap attempt ${attempt}/${maxRetries} failed:`, error.message);
        
        if (attempt < maxRetries) {
          console.log(`Waiting 5 seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          console.error(`All ${maxRetries} swap attempts failed`);
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

      console.log(`Jupiter Quote Request:`);
      console.log(`Input Mint: ${inputMint.toBase58()}`);
      console.log(`Output Mint: ${outputMint.toBase58()}`);
      console.log(`Amount: ${amount} lamports (${options.amount} SOL)`);
      console.log(`Slippage: ${options.slippageBps} bps`);

      // Build query parameters as per working Jupiter v6 API
      const quoteUrl = `${this.jupiterApiUrl}/quote?inputMint=${inputMint.toBase58()}&outputMint=${outputMint.toBase58()}&amount=${amount}&slippageBps=${options.slippageBps}&onlyDirectRoutes=false&asLegacyTransaction=false`;
      
      console.log(`Quote URL: ${quoteUrl}`);

      const response = await fetch(quoteUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Jupiter API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const quoteData = await response.json();
      
      if (!quoteData.outAmount || quoteData.outAmount === '0') {
        throw new Error('Jupiter quote returned zero output amount - insufficient liquidity');
      }

      console.log(`Quote received: ${quoteData.outAmount} output tokens`);
      console.log(`Route: ${quoteData.routes?.[0]?.marketInfos?.[0]?.amm?.label || 'Unknown'}`);
      
      return quoteData;
      
    } catch (error: any) {
      console.error(`Error getting quote:`, error);
      return null;
    }
  }

  // Check if wallet already has a token
  async checkWalletTokenBalance(tokenMint: string, wallet: any): Promise<boolean> {
    try {
      // Handle both WalletProvider and standard wallet objects
      const walletPubkey = wallet.getPublicKey ? wallet.getPublicKey() : wallet.publicKey;
      
      if (!walletPubkey) {
        console.error('Invalid wallet object - no public key found');
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
          console.log(`Wallet already has ${balance} of ${tokenMint}`);
          return true;
        }
      }

      return false;
      
    } catch (error) {
      console.error(`Error checking wallet token balance:`, error);
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
        prioritizationFeeLamports: 50000, // Increase priority fee to 0.00005 SOL for better success rate
      };

      console.log(`Getting swap instructions from: ${swapInstructionsUrl}`);

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
      console.log('Simulating swap transaction...');
      const simulation = await this.connection.simulateTransaction(transaction);
      
      if (simulation.value.err) {
        console.log('Swap simulation failed:', simulation.value.err);
        console.log('Simulation logs:', simulation.value.logs);
        throw new Error('Swap simulation failed');
      }
      
      console.log('Swap simulation successful, sending transaction...');
      
      // Send the transaction with improved retry and priority fee handling
      const signature = await this.connection.sendTransaction(transaction, {
        skipPreflight: false, // Keep preflight to catch errors early
        preflightCommitment: 'confirmed',
        maxRetries: 5, // Increase retry attempts
        minContextSlot: undefined, // Allow any slot
      });
      
      console.log(`Swap transaction sent: ${signature}`);
      
      // Wait for confirmation with improved timeout handling and error recovery
      console.log('Waiting for transaction confirmation...');
      console.log(`RPC Endpoint: ${this.connection.rpcEndpoint}`);
      console.log(`Commitment Level: confirmed`);
      
      let confirmation;
      let txStatus;
      
      try {
        // Try to confirm the transaction with a longer timeout
        console.log('Attempting confirmation...');
        confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
          console.log('Swap transaction failed:', confirmation.value.err);
          throw new Error('Swap transaction failed');
        }
        
        console.log(`Swap successful! Transaction confirmed: ${signature}`);
        return signature;
        
      } catch (confirmError: any) {
        console.log('Transaction confirmation failed, investigating...');
        console.log('Error:', confirmError.message);
        
        // Use a more robust confirmation strategy with longer timeouts
        console.log('Attempting extended confirmation strategy...');
        
        // Wait longer and check multiple times
        for (let attempt = 1; attempt <= 6; attempt++) {
          console.log(`Extended confirmation attempt ${attempt}/6...`);
          
          try {
            // Wait progressively longer between attempts
            const waitTime = attempt * 5000; // 5s, 10s, 15s, 20s, 25s, 30s
            console.log(`Waiting ${waitTime/1000} seconds before check ${attempt}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // Check transaction status
            txStatus = await this.connection.getSignatureStatus(signature);
            console.log(`Attempt ${attempt}/6 - Status: ${txStatus.value?.confirmationStatus || 'unknown'}`);
            
            if (txStatus.value?.confirmationStatus === 'confirmed' || txStatus.value?.confirmationStatus === 'finalized') {
              console.log(`Transaction confirmed after extended wait (attempt ${attempt})!`);
              console.log(`Status: ${txStatus.value.confirmationStatus}`);
              return signature;
            }
            
            // Check if transaction failed
            if (txStatus.value?.err) {
              console.log(`Transaction failed on-chain (attempt ${attempt}):`, txStatus.value.err);
              throw new Error(`Transaction failed on-chain: ${JSON.stringify(txStatus.value.err)}`);
            }
            
            // If still processing, continue to next attempt
            if (txStatus.value?.confirmationStatus === 'processed') {
              console.log(`Transaction still processing, continuing to next attempt...`);
              continue;
            }
            
          } catch (attemptError: any) {
            console.log(`Attempt ${attempt} failed:`, attemptError.message);
            if (attempt === 6) {
              throw attemptError; // Re-throw on final attempt
            }
            continue;
          }
        }
        
        // If we get here, all extended attempts failed
        console.log('All extended confirmation attempts failed, checking final status...');
        
        // Final status check
        try {
          txStatus = await this.connection.getSignatureStatus(signature);
          
          if (txStatus.value?.confirmationStatus === 'confirmed' || txStatus.value?.confirmationStatus === 'finalized') {
            console.log('Final status check shows transaction succeeded!');
            return signature;
          }
          
          if (txStatus.value?.err) {
            console.log('Final status check shows transaction failed:', txStatus.value.err);
            throw new Error(`Transaction failed on-chain: ${JSON.stringify(txStatus.value.err)}`);
          }
          
          // Check recent transactions to see if ours went through
          const recentTxs = await this.connection.getSignaturesForAddress(walletPubkey, { limit: 10 });
          const ourTx = recentTxs.find(tx => tx.signature === signature);
          
          if (ourTx && ourTx.err === null) {
            console.log('Transaction found in recent history and appears successful!');
            return signature;
          }
          
          // Try to get the transaction details directly
          try {
            console.log('Attempting to fetch transaction details directly...');
            const txDetails = await this.connection.getTransaction(signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0
            });
            
            if (txDetails && !txDetails.meta?.err) {
              console.log('Transaction details fetched and appears successful!');
              return signature;
            } else if (txDetails?.meta?.err) {
              console.log('Transaction details show failure:', txDetails.meta.err);
              throw new Error(`Transaction failed on-chain: ${JSON.stringify(txDetails.meta.err)}`);
            }
          } catch (fetchError: any) {
            console.log('Failed to fetch transaction details:', fetchError.message);
          }
          
          // If we still can't determine status, throw a more informative error
          throw new Error(`Transaction status unclear after extended confirmation attempts. Signature: ${signature}. Check Solana Explorer for final status.`);
          
        } catch (finalError: any) {
          console.log('Final status check failed:', finalError.message);
          throw new Error(`Transaction confirmation failed after extended attempts. Signature: ${signature}. Error: ${finalError.message}`);
        }
      }
      
    } catch (error) {
      console.error(`Error executing swap transaction:`, error);
      throw error;
    }
  }
}
