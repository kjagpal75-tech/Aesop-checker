#!/bin/bash

# Quick Start Script for Aesop Shift Checker
# Run this on your Google Cloud VM to start the service immediately

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

echo -e "${BLUE}🚀 Quick Start Aesop Shift Checker${NC}"

# Check if we're in the right directory
if [[ ! -f "aesop-checker.js" ]]; then
    print_error "aesop-checker.js not found!"
    print_error "Please run this script from the aesop-checker directory"
    exit 1
fi

# Install dependencies if needed
if [[ ! -d "node_modules" ]]; then
    echo -e "${BLUE}📦 Installing dependencies...${NC}"
    npm install
fi

# Create environment file if it doesn't exist
if [[ ! -f ".env" ]]; then
    print_warning "Creating .env file - please edit it with your credentials"
    cp .env.example .env 2>/dev/null || cat > .env <<EOF
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
fi

# Open firewall port
echo -e "${BLUE}🔥 Opening port 443...${NC}"
if command -v ufw &> /dev/null; then
    sudo ufw allow 443/tcp 2>/dev/null || true
    sudo ufw allow 80/tcp 2>/dev/null || true  # For HTTP redirect
fi

# Create GCP firewall rule
if command -v gcloud &> /dev/null; then
    echo -e "${BLUE}☁️  Creating GCP firewall rule...${NC}"
    gcloud compute firewall-rules create allow-aesop-https \
        --allow tcp:443,tcp:80 \
        --source-ranges 0.0.0.0/0 \
        --description "Allow Aesop HTTPS ports" \
        --quiet 2>/dev/null || true
fi

# Kill any existing process on port 3000
echo -e "${BLUE}🔄 Stopping any existing service...${NC}"
pkill -f "node.*aesop-checker" 2>/dev/null || true
sleep 2

# Start the service
echo -e "${BLUE}🚀 Starting Aesop Shift Checker service...${NC}"
nohup node aesop-checker.js > aesop-checker.log 2>&1 &
SERVICE_PID=$!

echo $SERVICE_PID > aesop-checker.pid

# Wait for service to start
sleep 5

# Check if service is running
if kill -0 $SERVICE_PID 2>/dev/null; then
    print_status "Service started successfully!"
    echo ""
    echo -e "${BLUE}📋 Service Information:${NC}"
    echo "PID: $SERVICE_PID"
    echo "Port: 3000 (backend) / 443 (HTTPS frontend)"
    echo "External IP: 34.71.197.190"
    echo "Service URL: https://34.71.197.190"
    echo "API Endpoint: https://34.71.197.190/api/shifts"
    echo "Health Check: https://34.71.197.190/health/detailed"
    echo ""
    echo -e "${GREEN}React Native app can now connect to: https://34.71.197.190/api/shifts${NC}"
    echo ""
    echo -e "${BLUE}📝 To view logs: tail -f aesop-checker.log${NC}"
    echo -e "${BLUE}🛑 To stop service: ./stop-service.sh${NC}"
    echo -e "${BLUE}🔄 To restart service: ./restart-service.sh${NC}"
    
    # Test connectivity
    echo -e "${BLUE}🔍 Testing service...${NC}"
    if curl -s -f http://localhost:3000/health/detailed > /dev/null; then
        print_status "Service is responding locally!"
    else
        print_warning "Service not responding locally - check logs"
    fi
else
    print_error "Service failed to start!"
    echo -e "${RED}Check logs: tail -f aesop-checker.log${NC}"
    exit 1
fi
