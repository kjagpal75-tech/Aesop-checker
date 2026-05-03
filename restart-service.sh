#!/bin/bash

# Restart Aesop Shift Checker Service

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

echo -e "${BLUE}🔄 Restarting Aesop Shift Checker Service${NC}"

# Stop the service
./stop-service.sh

# Wait a moment
sleep 2

# Start the service
./quick-start.sh
