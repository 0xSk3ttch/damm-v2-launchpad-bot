# Scripts Directory

This directory contains all executable scripts organized by functionality.

## Directory Structure

```
scripts/
├── position-management/     # DAMM position management scripts
├── token-management/        # Token wallet management scripts
├── utilities/              # Utility and testing scripts
└── manage-bot.sh          # Bot management shell script
```

## Quick Start

### Position Management
- **Close all positions**: `npm run close-all-damm`
- **Monitor positions**: `npm run monitor-damm`

### Token Management
- **List wallet tokens**: `npm run list-tokens`
- **Swap tokens to SOL**: `npm run swap-tokens`

### Utilities
- **Zap out functionality**: `npm run zap-out`

## Script Categories

### Position Management
Scripts for managing DAMM positions including closing, monitoring, and automated management.

### Token Management
Scripts for managing tokens in your wallet including listing, analyzing, and swapping.

### Utilities
Utility scripts for testing, debugging, and core functionality.

## Usage

All scripts can be run using npm scripts defined in `package.json`. Each script directory contains its own README with detailed usage instructions.
