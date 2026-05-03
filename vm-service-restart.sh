#!/bin/bash

# Aesop Shift Checker Service Restart Script

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo -e "${BLUE}🔄 $1${NC}"
}

# Configuration
SERVICE_DIR="/home/kjagpal75/Aesop-checker"
SERVICE_USER="kjagpal75"

print_header "Restarting Aesop Shift Checker Service"

# Check if running as correct user
if [[ "$USER" != "$SERVICE_USER" ]]; then
    print_error "This script must be run as user: $SERVICE_USER"
    print_error "Current user: $USER"
    print_error "Please run: sudo -u $SERVICE_USER bash $0"
    exit 1
fi

cd "$SERVICE_DIR"

# Stop the service
print_header "Stopping Service"
if [[ -f "./vm-service-stop.sh" ]]; then
    ./vm-service-stop.sh
else
    print_error "Stop script not found"
    exit 1
fi

# Wait a moment
sleep 3

# Start the service
print_header "Starting Service"
if [[ -f "./vm-service-start.sh" ]]; then
    ./vm-service-start.sh
else
    print_error "Start script not found"
    exit 1
fi

print_status "Service restart complete!"
