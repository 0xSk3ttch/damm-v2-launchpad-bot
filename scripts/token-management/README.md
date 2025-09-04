# Token Management Scripts

This directory contains scripts for managing tokens in your wallet.

## Scripts

### `list-wallet-tokens.ts`
Lists all tokens in your wallet with their estimated SOL and USD values.

**Usage:**
```bash
npm run list-tokens
```

**Features:**
- Shows all token balances
- Estimates SOL and USD values using Jupiter API
- Identifies profitable tokens for swapping
- Handles tokens with no available routes

### `swap-tokens-to-sol.ts`
Analyzes tokens for profitability and executes swaps to SOL.

**Usage:**
```bash
npm run swap-tokens
```

**Features:**
- Analyzes token profitability vs gas costs
- Swaps only profitable tokens to SOL
- Uses Jupiter API for optimal routing
- Provides detailed swap results
