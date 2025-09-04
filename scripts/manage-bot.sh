#!/bin/bash

# DAMM Bot Management Script
# This script helps manage the bot processes

BOT_NAME="damm-bot"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if bot is running
is_bot_running() {
    pgrep -f "ts-node.*src/app/index.ts" > /dev/null
}

# Function to get bot process IDs
get_bot_pids() {
    pgrep -f "ts-node.*src/app/index.ts"
}

# Function to start the bot
start_bot() {
    print_status "Starting DAMM Bot..."
    
    if is_bot_running; then
        print_warning "Bot is already running!"
        return 1
    fi
    
    cd "$PROJECT_DIR"
    
    # Start the bot in the background
    nohup npm start > bot.log 2>&1 &
    BOT_PID=$!
    
    # Wait a moment to see if it starts successfully
    sleep 3
    
    if is_bot_running; then
        print_success "Bot started successfully! PID: $BOT_PID"
        print_status "Logs are being written to: bot.log"
        print_status "Use './scripts/manage-bot.sh status' to check status"
        print_status "Use './scripts/manage-bot.sh stop' to stop the bot"
    else
        print_error "Failed to start bot. Check bot.log for details."
        return 1
    fi
}

# Function to stop the bot gracefully
stop_bot() {
    print_status "Stopping DAMM Bot gracefully..."
    
    if ! is_bot_running; then
        print_warning "Bot is not running!"
        return 1
    fi
    
    # Get all bot process IDs
    local pids=$(get_bot_pids)
    
    if [ -z "$pids" ]; then
        print_warning "No bot processes found!"
        return 1
    fi
    
    print_status "Found bot processes: $pids"
    
    # Send SIGINT (Ctrl+C) to trigger graceful shutdown
    for pid in $pids; do
        print_status "Sending SIGINT to process $pid..."
        kill -INT "$pid" 2>/dev/null
    done
    
    # Wait for graceful shutdown
    print_status "Waiting for graceful shutdown..."
    local timeout=30
    local count=0
    
    while is_bot_running && [ $count -lt $timeout ]; do
        sleep 1
        count=$((count + 1))
        echo -n "."
    done
    echo
    
    if is_bot_running; then
        print_warning "Graceful shutdown failed, forcing stop..."
        for pid in $pids; do
            print_status "Force killing process $pid..."
            kill -9 "$pid" 2>/dev/null
        done
        
        sleep 2
        
        if is_bot_running; then
            print_error "Failed to stop bot processes!"
            return 1
        fi
    fi
    
    print_success "Bot stopped successfully!"
}

# Function to check bot status
check_status() {
    print_status "Checking DAMM Bot status..."
    
    if is_bot_running; then
        local pids=$(get_bot_pids)
        print_success "Bot is RUNNING"
        print_status "Process IDs: $pids"
        
        # Show recent logs
        if [ -f "bot.log" ]; then
            print_status "Recent logs (last 10 lines):"
            tail -10 bot.log
        fi
    else
        print_warning "Bot is NOT running"
        
        # Check if there are any leftover processes
        local leftover=$(pgrep -f "node.*damm" 2>/dev/null)
        if [ -n "$leftover" ]; then
            print_warning "Found leftover processes: $leftover"
            print_status "Use './scripts/manage-bot.sh cleanup' to remove them"
        fi
    fi
}

# Function to show logs
show_logs() {
    if [ -f "bot.log" ]; then
        print_status "Showing bot logs (use Ctrl+C to exit):"
        tail -f bot.log
    else
        print_error "No bot.log file found. Bot may not have been started yet."
    fi
}

# Function to cleanup leftover processes
cleanup() {
    print_status "Cleaning up leftover processes..."
    
    # Find any leftover node processes related to the bot
    local leftover=$(pgrep -f "node.*damm\|ts-node.*src/app/index.ts" 2>/dev/null)
    
    if [ -n "$leftover" ]; then
        print_status "Found leftover processes: $leftover"
        
        for pid in $leftover; do
            print_status "Killing process $pid..."
            kill -9 "$pid" 2>/dev/null
        done
        
        sleep 2
        
        # Check if cleanup was successful
        leftover=$(pgrep -f "node.*damm\|ts-node.*src/app/index.ts" 2>/dev/null)
        if [ -z "$leftover" ]; then
            print_success "Cleanup completed successfully!"
        else
            print_error "Some processes could not be killed: $leftover"
        fi
    else
        print_success "No leftover processes found!"
    fi
}

# Function to restart the bot
restart_bot() {
    print_status "Restarting DAMM Bot..."
    stop_bot
    sleep 2
    start_bot
}

# Function to show help
show_help() {
    echo "DAMM Bot Management Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  start     Start the bot"
    echo "  stop      Stop the bot gracefully"
    echo "  restart   Restart the bot"
    echo "  status    Check bot status"
    echo "  logs      Show live logs"
    echo "  cleanup   Clean up leftover processes"
    echo "  help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 start      # Start the bot"
    echo "  $0 stop       # Stop the bot"
    echo "  $0 status     # Check if bot is running"
    echo "  $0 logs       # Show live logs"
}

# Main script logic
case "${1:-help}" in
    start)
        start_bot
        ;;
    stop)
        stop_bot
        ;;
    restart)
        restart_bot
        ;;
    status)
        check_status
        ;;
    logs)
        show_logs
        ;;
    cleanup)
        cleanup
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac

