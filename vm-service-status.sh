#!/bin/bash

# Aesop Shift Checker Service Status Check Script

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
    echo -e "${BLUE}📊 $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Configuration
SERVICE_DIR="/home/kjagpal75/Aesop-checker"
SERVICE_USER="kjagpal75"
SERVICE_NAME="aesop-checker"
LOG_FILE="$SERVICE_DIR/aesop-checker.log"
PID_FILE="$SERVICE_DIR/aesop-checker.pid"

print_header "Aesop Shift Checker Service Status"

# Check if running as correct user
if [[ "$USER" != "$SERVICE_USER" ]]; then
    print_error "This script must be run as user: $SERVICE_USER"
    print_error "Current user: $USER"
    print_error "Please run: sudo -u $SERVICE_USER bash $0"
    exit 1
fi

cd "$SERVICE_DIR"

# Service Information
print_header "Service Information"
echo "Service Name: $SERVICE_NAME"
echo "Service User: $SERVICE_USER"
echo "Service Directory: $SERVICE_DIR"
echo "Log File: $LOG_FILE"
echo "PID File: $PID_FILE"
echo ""

# Check PID file and process
print_header "Process Status"
if [[ -f "$PID_FILE" ]]; then
    service_pid=$(cat "$PID_FILE")
    if kill -0 "$service_pid" 2>/dev/null; then
        print_status "Service is running (PID: $service_pid)"
        
        # Get process details
        process_info=$(ps -p "$service_pid" -o pid,ppid,etime,pcpu,pmem,cmd --no-headers)
        echo "Process Details: $process_info"
        
        # Calculate uptime
        start_time=$(ps -p "$service_pid" -o lstart --no-headers | xargs)
        echo "Started: $start_time"
    else
        print_error "PID file exists but process not running"
        print_warning "Stale PID file - service may have crashed"
        rm -f "$PID_FILE"
    fi
else
    print_warning "No PID file found"
fi

# Check for any remaining processes
print_header "Process Check"
all_processes=$(ps aux | grep -v grep | grep "node.*aesop-checker" | awk '{print $2}')
if [[ -n "$all_processes" ]]; then
    print_warning "Found aesop-checker processes:"
    ps aux | grep -v grep | grep "node.*aesop-checker"
else
    print_status "No stray processes found"
fi

# Port status
print_header "Port Status"
if sudo netstat -tlnp 2>/dev/null | grep -q ":3000 "; then
    port_info=$(sudo netstat -tlnp 2>/dev/null | grep ":3000 ")
    print_status "Port 3000 is listening:"
    echo "$port_info"
else
    print_warning "Port 3000 is not listening"
fi

if sudo netstat -tlnp 2>/dev/null | grep -q ":443 "; then
    port_info=$(sudo netstat -tlnp 2>/dev/null | grep ":443 ")
    print_status "Port 443 is listening:"
    echo "$port_info"
else
    print_warning "Port 443 is not listening"
fi

# Service connectivity tests
print_header "Connectivity Tests"

# Test local health endpoint
if curl -s -f http://localhost:3000/health/detailed > /dev/null 2>&1; then
    health_response=$(curl -s http://localhost:3000/health/detailed 2>/dev/null)
    print_status "Local health check passed"
    echo "Health Response: $health_response" | jq . 2>/dev/null || echo "Health Response: $health_response"
else
    print_error "Local health check failed"
fi

# Test HTTPS API endpoint
if curl -k -s -f https://34.71.197.190/api/shifts > /dev/null 2>&1; then
    api_response=$(curl -k -s https://34.71.197.190/api/shifts 2>/dev/null)
    print_status "HTTPS API endpoint working"
    echo "API Response: $api_response" | jq . 2>/dev/null || echo "API Response: $api_response"
else
    print_error "HTTPS API endpoint not responding"
fi

# Test web dashboard
if curl -k -s -L https://34.71.197.190/ | grep -q "login\|Login" > /dev/null 2>&1; then
    print_status "Web dashboard accessible (login page)"
else
    print_warning "Web dashboard may not be accessible"
fi

# Recent logs
print_header "Recent Logs"
if [[ -f "$LOG_FILE" ]]; then
    echo "Last 20 lines of log file:"
    tail -20 "$LOG_FILE"
else
    print_warning "No log file found"
fi

# System resources
print_header "System Resources"
echo "Memory Usage:"
free -h
echo ""
echo "Disk Usage:"
df -h "$SERVICE_DIR"
echo ""
echo "CPU Load:"
uptime

# Service URLs
print_header "Service URLs"
echo "Web Dashboard: https://34.71.197.190/ (login required)"
echo "API Endpoint: https://34.71.197.190/api/shifts"
echo "Health Check: https://34.71.197.190/health/detailed"
echo ""
echo "Login Credentials:"
echo "  Username: admin"
echo "  Password: Aesop@2026!"

# Management commands
print_header "Management Commands"
echo "Start service: ./vm-service-start.sh"
echo "Stop service: ./vm-service-stop.sh"
echo "Restart service: ./vm-service-restart.sh"
echo "Check status: ./vm-service-status.sh"
echo "View logs: tail -f $LOG_FILE"

print_header "Status Check Complete"
