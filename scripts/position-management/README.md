# Position Management Scripts

This directory contains scripts for managing DAMM positions.

## Scripts

### `close-all-damm-positions.ts`
Closes all DAMM positions and automatically converts received tokens to SOL.

**Usage:**
```bash
npm run close-all-damm
```

**Features:**
- Closes all positions with unlocked liquidity
- Automatically swaps received tokens to SOL (if profitable)
- Handles dust positions gracefully
- Provides detailed transaction logs

### `damm-position-monitor.ts`
Continuously monitors for new DAMM positions and automatically closes them after 30 minutes.

**Usage:**
```bash
npm run monitor-damm
```

**Features:**
- Monitors for new positions in real-time
- Auto-closes positions after 30 minutes
- Converts tokens to SOL automatically
- Sends Discord notifications
- Excludes testing and dust positions
