# DAMM Liquidity Bot

## Prerequisites

- Node.js 18+ 
- TypeScript (will be installed automatically with npm install)
- Solana CLI tools
- A Solana wallet with SOL for gas fees and token purchases
- Discord webhook URL for notifications

## 🛠️ Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/damm-liquidity-bot.git
cd damm-liquidity-bot
```

2. **Install dependencies**
```bash
npm install
# This will automatically install TypeScript and all other required dependencies
```

3. **Build the project**
```bash
npm run build
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Solana Configuration
RPC_ENDPOINT=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
WS_ENDPOINT=wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
PRIVATE_KEY=YOUR_WALLET_PRIVATE_KEY

# Pump.fun Configuration
PUMP_FUN_PROGRAM_ID=39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg

# Bot Configuration
SOL_AMOUNT=0.002 // Amount per side
ADD_LIQUIDITY=true

# Discord Configuration
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
```

### Configuration Details

| Variable | Description | Example |
|----------|-------------|---------|
| `RPC_ENDPOINT` | Solana RPC endpoint (Helius recommended) | `https://mainnet.helius-rpc.com/?api-key=xxx` |
| `WS_ENDPOINT` | WebSocket endpoint for real-time monitoring | `wss://mainnet.helius-rpc.com/?api-key=xxx` |
| `PRIVATE_KEY` | Your wallet's private key (base58 encoded) | `4xQy...` |
| `PUMP_FUN_PROGRAM_ID` | Pump.fun program ID (mainnet) | `39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg` |
| `SOL_AMOUNT` | SOL amount per token purchase (in SOL) | `0.002` |
| `ADD_LIQUIDITY` | Enable/disable automatic liquidity addition | `true` |
| `DISCORD_WEBHOOK_URL` | Discord webhook for notifications | `https://discord.com/api/webhooks/xxx/xxx` |

## 🔑 Wallet Setup

### 1. Generate a New Wallet (Recommended)
```bash
solana-keygen new --outfile keypair.json
```

### 2. Get Your Private Key
```bash
solana-keygen pubkey keypair.json
```

### 3. Fund Your Wallet
- Send SOL to your wallet address for gas fees and token purchases
- Recommended: At least 0.1 SOL for gas + 0.01 SOL per token you plan to purchase

### 4. Add Private Key to .env
```bash
# Convert keypair to base58
solana-keygen pubkey keypair.json
# Copy the output to your .env file
```

## Usage

### Start the Bot
```bash
npm start
```

### Development Mode
```bash
npm run dev
```

### Build Only
```bash
npm run build
```

## How It Works

1. **Migration Detection**: Bot monitors Pump.fun for new token migrations
2. **Pool Discovery**: Searches for DAMM v2 pools containing migrated tokens
3. **Criteria Filtering**: Applies strict filtering criteria to identify qualifying pools
4. **Token Purchase**: Automatically purchases tokens via Jupiter aggregator
5. **Position Creation**: Creates optimal DAMM positions using all available tokens
6. **Liquidity Addition**: Adds liquidity to the pool with calculated SOL amounts
7. **Notifications**: Sends Discord alerts for each major event

## 🎯 Pool Criteria

The bot only targets pools that meet **ALL** of these criteria:

- ✅ **Contains SOL/WSOL**: Must have SOL or wrapped SOL
- ✅ **Linear Fee Schedule**: No exponential fee schedules
- ✅ **Quote Token Only Fees**: Fees collected only in SOL, not in both tokens
- ✅ **Contains Migrated Token**: Must contain the token that just migrated from Pump.fun

## Dependencies

### Core Dependencies
```json
{
  "@meteora-ag/cp-amm-sdk": "^0.1.0",
  "@solana/web3.js": "^1.87.0",
  "@solana/spl-token": "^0.3.9",
  "bn.js": "^5.2.1",
  "dotenv": "^16.3.1"
}
```

### Development Dependencies
```json
{
  "typescript": "^5.0.0",
  "ts-node": "^10.9.0",
  "@types/node": "^20.0.0",
  "@types/bn.js": "^5.1.0"
}
```

## 📱 Discord Notifications

The bot sends real-time Discord notifications for:

- 🎓 **Migration Detected**: New token migration on Pump.fun
- 🎯 **Pool Found**: Qualifying DAMM pool discovered
- 🏊 **Position Created**: Successfully created liquidity position

## ⚠️ Important Notes

### Security
- **Never share your private key**
- Use a dedicated wallet for the bot
- Monitor your wallet activity regularly
- Start with small amounts to test

### Risk Management
- The bot automatically purchases tokens and provides liquidity
- Market conditions can affect position performance
- Monitor pool health and token performance
- Consider setting stop-loss mechanisms

### Technical Limitations
- Requires stable RPC connection
- Network congestion may affect transaction success
- Some pools may have insufficient liquidity
- Position creation may fail due to slippage

## 🐛 Troubleshooting

### Common Issues

1. **"Insufficient SOL balance"**
   - Fund your wallet with more SOL
   - Check gas fee requirements

2. **"Token not found in wallet"**
   - Wait for Jupiter swap to settle (up to 30 seconds)
   - Check transaction status on Solana Explorer

3. **"Number can only safely store up to 53 bits"**
   - Bot automatically rounds token amounts to avoid precision issues
   - This is normal for very large numbers

4. **"Transaction confirmation failed"**
   - Network congestion - bot will retry automatically
   - Check RPC endpoint health

### RPC Issues
- Use reliable RPC endpoints (Helius recommended)
- Check your API key limits
- Monitor network latency

## 📈 Performance Tips

- Use high-performance RPC endpoints
- Monitor network congestion
- Set appropriate slippage tolerance
- Regular wallet maintenance

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚖️ Disclaimer

This bot is for educational and personal use. Cryptocurrency trading involves significant risk. Use at your own risk and never invest more than you can afford to lose.

## 🆘 Support

- Create an issue on GitHub
- Check the troubleshooting section
- Review Solana and DAMM documentation

## 🔗 Useful Links

- [Solana Documentation](https://docs.solana.com/)
- [DAMM v2 Documentation](https://docs.meteora.ag/)
- [Pump.fun](https://pump.fun/)
- [Jupiter Aggregator](https://jup.ag/)

---

**Happy trading! 🚀**
