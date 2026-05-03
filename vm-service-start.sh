#!/bin/bash

# Aesop Shift Checker Service Start Script
# Comprehensive startup with all dependencies and authentication

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
    echo -e "${BLUE}🚀 $1${NC}"
}

# Configuration
SERVICE_DIR="/home/kjagpal75/Aesop-checker"
SERVICE_USER="kjagpal75"
SERVICE_NAME="aesop-checker"
LOG_FILE="$SERVICE_DIR/aesop-checker.log"
PID_FILE="$SERVICE_DIR/aesop-checker.pid"

print_header "Starting Aesop Shift Checker Service"

# Check if running as correct user
if [[ "$USER" != "$SERVICE_USER" ]]; then
    print_error "This script must be run as user: $SERVICE_USER"
    print_error "Current user: $USER"
    print_error "Please run: sudo -u $SERVICE_USER bash $0"
    exit 1
fi

# Check if service directory exists
if [[ ! -d "$SERVICE_DIR" ]]; then
    print_error "Service directory not found: $SERVICE_DIR"
    exit 1
fi

cd "$SERVICE_DIR"

# Check if required files exist
print_header "Checking Dependencies"
required_files=("aesop-checker.js" "auth-middleware.js" "config.js" "package.json" "public/login.html")
for file in "${required_files[@]}"; do
    if [[ ! -f "$file" ]]; then
        print_error "Required file missing: $file"
        exit 1
    else
        print_status "Found: $file"
    fi
done

# Check Node.js version
print_header "Checking Node.js"
if ! command -v node &> /dev/null; then
    print_error "Node.js not found"
    exit 1
fi

node_version=$(node -v | cut -d'v' -f2)
print_status "Node.js version: $node_version"

# Check if Node.js version is sufficient
if [[ $(echo "$node_version" | cut -d'.' -f1) -lt 16 ]]; then
    print_warning "Node.js version may be too old. Consider upgrading to v16+"
fi

# Install dependencies if needed
if [[ ! -d "node_modules" ]] || [[ ! -f "node_modules/.package-lock.json" ]]; then
    print_header "Installing Dependencies"
    npm install
    print_status "Dependencies installed"
else
    print_status "Dependencies already installed"
fi

# Check environment file
print_header "Checking Environment"
if [[ ! -f ".env" ]]; then
    print_warning "Environment file not found, creating template"
    cat > .env <<EOF
# Aesop Configuration
AESOP_URL=https://login.frontlineeducation.com/login?signin=f031bc8d11b97a292b84a51dad08ca09&productId=ABSMGMT&clientId=ABSMGMT#/login
AESOP_USERNAME=your_username_here
AESOP_PASSWORD=your_password_here

# Email Configuration
EMAIL_TO=your_email@example.com
EMAIL_FROM=your_email@gmail.com
EMAIL_PASSWORD=your_app_password_here

# Dashboard Authentication
DASHBOARD_USERNAME=admin

# Auto-Accept Settings
AUTO_ACCEPT_ENABLED=false
AUTO_ACCEPT_HOURS_IN_FUTURE=48
AUTO_ACCEPT_LOG_ONLY=false

# Check Interval (milliseconds)
CHECK_INTERVAL=60000
REAL_TIME_MODE=false

# Public URL
PUBLIC_URL=https://34.71.197.190
EOF
    print_warning "Please edit .env file with your actual credentials"
else
    print_status "Environment file found"
fi

# Stop existing service if running
print_header "Stopping Existing Service"
if [[ -f "$PID_FILE" ]]; then
    old_pid=$(cat "$PID_FILE")
    if kill -0 "$old_pid" 2>/dev/null; then
        print_status "Stopping existing service (PID: $old_pid)"
        kill "$old_pid"
        sleep 2
        # Force kill if still running
        if kill -0 "$old_pid" 2>/dev/null; then
            print_warning "Force killing service"
            kill -9 "$old_pid" 2>/dev/null || true
        fi
    else
        print_warning "Stale PID file found, removing"
    fi
    rm -f "$PID_FILE"
fi

# Kill any remaining processes
pkill -f "node.*aesop-checker" 2>/dev/null || true
sleep 2

# Check if port 3000 is available
print_header "Checking Port Availability"
if sudo netstat -tlnp 2>/dev/null | grep -q ":3000 "; then
    print_error "Port 3000 is still in use"
    sudo netstat -tlnp 2>/dev/null | grep ":3000 "
    print_error "Please manually stop the process using port 3000"
    exit 1
else
    print_status "Port 3000 is available"
fi

# Start the service
print_header "Starting Service"
nohup node aesop-checker.js > "$LOG_FILE" 2>&1 &
service_pid=$!

# Save PID
echo "$service_pid" > "$PID_FILE"

# Wait for service to start
print_header "Waiting for Service to Initialize"
sleep 5

# Check if service is running
if kill -0 "$service_pid" 2>/dev/null; then
    print_status "Service started successfully!"
    print_status "PID: $service_pid"
    print_status "Log file: $LOG_FILE"
    
    # Test local connectivity
    print_header "Testing Service"
    if curl -s -f http://localhost:3000/health/detailed > /dev/null; then
        print_status "Local health check passed"
    else
        print_warning "Local health check failed - checking logs"
        tail -10 "$LOG_FILE"
    fi
    
    # Test HTTPS connectivity
    if curl -k -s -f https://34.71.197.190/api/shifts > /dev/null; then
        print_status "HTTPS API endpoint working"
    else
        print_warning "HTTPS API endpoint not responding - may need to check Nginx"
    fi
    
    # Show recent logs
    print_header "Recent Service Logs"
    tail -15 "$LOG_FILE"
    
    print_header "Service Information"
    echo "Service Name: $SERVICE_NAME"
    echo "Service User: $SERVICE_USER"
    echo "Service PID: $service_pid"
    echo "Service Directory: $SERVICE_DIR"
    echo "Log File: $LOG_FILE"
    echo "PID File: $PID_FILE"
    echo ""
    echo "Service URLs:"
    echo "  Web Dashboard: https://34.71.197.190/ (login required)"
    echo "  API Endpoint: https://34.71.197.190/api/shifts"
    echo "  Health Check: https://34.71.197.190/health/detailed"
    echo ""
    echo "Login Credentials:"
    echo "  Username: admin"
    echo "  Password: Aesop@2026!"
    echo ""
    echo "Management Commands:"
    echo "  View logs: tail -f $LOG_FILE"
    echo "  Stop service: ./vm-service-stop.sh"
    echo "  Restart service: ./vm-service-restart.sh"
    echo "  Check status: ./vm-service-status.sh"
    
else
    print_error "Service failed to start!"
    print_error "Check logs: tail -f $LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi

print_status "Service startup complete!"
