#!/bin/bash

# Stop Aesop Shift Checker Service

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

echo -e "${BLUE}🛑 Stopping Aesop Shift Checker Service${NC}"

# Stop using PID file if it exists
if [[ -f "aesop-checker.pid" ]]; then
    PID=$(cat aesop-checker.pid)
    if kill -0 $PID 2>/dev/null; then
        kill $PID
        print_status "Service stopped (PID: $PID)"
    else
        print_error "Process $PID not running"
    fi
    rm -f aesop-checker.pid
fi

# Kill any remaining processes
pkill -f "node.*aesop-checker" 2>/dev/null && print_status "Killed remaining processes"

print_status "Service stopped completely"
