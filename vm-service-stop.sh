#!/bin/bash

# Aesop Shift Checker Service Stop Script

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
    echo -e "${BLUE}🛑 $1${NC}"
}

# Configuration
SERVICE_DIR="/home/kjagpal75/Aesop-checker"
SERVICE_USER="kjagpal75"
SERVICE_NAME="aesop-checker"
LOG_FILE="$SERVICE_DIR/aesop-checker.log"
PID_FILE="$SERVICE_DIR/aesop-checker.pid"

print_header "Stopping Aesop Shift Checker Service"

# Check if running as correct user
if [[ "$USER" != "$SERVICE_USER" ]]; then
    print_error "This script must be run as user: $SERVICE_USER"
    print_error "Current user: $USER"
    print_error "Please run: sudo -u $SERVICE_USER bash $0"
    exit 1
fi

cd "$SERVICE_DIR"

# Check if service is running using PID file
if [[ -f "$PID_FILE" ]]; then
    service_pid=$(cat "$PID_FILE")
    if kill -0 "$service_pid" 2>/dev/null; then
        print_status "Stopping service (PID: $service_pid)"
        kill "$service_pid"
        
        # Wait for graceful shutdown
        sleep 3
        
        # Check if still running
        if kill -0 "$service_pid" 2>/dev/null; then
            print_warning "Service didn't stop gracefully, force killing..."
            kill -9 "$service_pid" 2>/dev/null || true
            sleep 1
        fi
        
        if ! kill -0 "$service_pid" 2>/dev/null; then
            print_status "Service stopped successfully"
        else
            print_error "Failed to stop service"
            exit 1
        fi
    else
        print_warning "Service PID file exists but process not running"
        print_warning "Removing stale PID file"
    fi
    rm -f "$PID_FILE"
else
    print_warning "No PID file found, checking for running processes"
fi

# Kill any remaining processes
print_header "Cleaning Up Remaining Processes"
remaining_processes=$(ps aux | grep -v grep | grep "node.*aesop-checker" | awk '{print $2}')

if [[ -n "$remaining_processes" ]]; then
    print_warning "Found remaining processes: $remaining_processes"
    for pid in $remaining_processes; do
        print_status "Killing process $pid"
        kill "$pid" 2>/dev/null || true
    done
    
    # Force kill if still running
    sleep 2
    remaining_processes=$(ps aux | grep -v grep | grep "node.*aesop-checker" | awk '{print $2}')
    if [[ -n "$remaining_processes" ]]; then
        print_warning "Force killing remaining processes: $remaining_processes"
        for pid in $remaining_processes; do
            kill -9 "$pid" 2>/dev/null || true
        done
    fi
else
    print_status "No remaining processes found"
fi

# Check if port 3000 is still in use
print_header "Checking Port Status"
if sudo netstat -tlnp 2>/dev/null | grep -q ":3000 "; then
    print_warning "Port 3000 is still in use:"
    sudo netstat -tlnp 2>/dev/null | grep ":3000 "
    print_warning "You may need to manually kill the process using this port"
else
    print_status "Port 3000 is free"
fi

# Show final status
print_header "Stop Summary"
echo "Service: $SERVICE_NAME"
echo "User: $SERVICE_USER"
echo "Directory: $SERVICE_DIR"
echo "Log File: $LOG_FILE"
echo ""

# Show recent logs
if [[ -f "$LOG_FILE" ]]; then
    echo "Recent logs:"
    tail -10 "$LOG_FILE"
else
    print_warning "No log file found"
fi

print_status "Service stop complete!"
