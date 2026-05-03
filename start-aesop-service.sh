#!/bin/bash

# Aesop Shift Checker Service Startup Script
# This script sets up and starts the backend service on Google Cloud VM

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SERVICE_NAME="aesop-checker"
SERVICE_PORT=3000
SERVICE_DIR="/opt/aesop-checker"
LOG_DIR="/var/log/aesop-checker"
SYSTEMD_SERVICE="/etc/systemd/system/aesop-checker.service"

echo -e "${BLUE}🚀 Starting Aesop Shift Checker Service Setup${NC}"

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root for security reasons"
   print_error "Please run as a regular user with sudo privileges"
   exit 1
fi

# Update system packages
echo -e "${BLUE}📦 Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y

# Install required dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
sudo apt install -y curl wget git python3 python3-pip nodejs npm

# Install Node.js if not present or version is too old
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 16 ]]; then
    print_warning "Installing/updating Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Create service directory
echo -e "${BLUE}📁 Creating service directory...${NC}"
sudo mkdir -p $SERVICE_DIR
sudo mkdir -p $LOG_DIR

# Copy application files (assuming script is run from aesop-checker directory)
echo -e "${BLUE}📋 Copying application files...${NC}"
if [[ -f "./aesop-checker.js" ]]; then
    sudo cp -r ./* $SERVICE_DIR/
    print_status "Application files copied to $SERVICE_DIR"
else
    print_error "aesop-checker.js not found in current directory"
    print_error "Please run this script from the aesop-checker directory"
    exit 1
fi

# Install Node.js dependencies
echo -e "${BLUE}📦 Installing Node.js dependencies...${NC}"
cd $SERVICE_DIR
sudo npm install

# Create environment file template
echo -e "${BLUE}⚙️  Creating environment file template...${NC}"
if [[ ! -f "$SERVICE_DIR/.env" ]]; then
    sudo tee $SERVICE_DIR/.env > /dev/null <<EOF
# Aesop Configuration
AESOP_URL=https://login.frontlineeducation.com/login?signin=f031bc8d11b97a292b84a51dad08ca09&productId=ABSMGMT&clientId=ABSMGMT#/login
AESOP_USERNAME=your_username_here
AESOP_PASSWORD=your_password_here

# Email Configuration
EMAIL_TO=your_email@example.com
EMAIL_FROM=your_email@gmail.com
EMAIL_PASSWORD=your_app_password_here

# Dashboard Authentication (optional)
DASHBOARD_USERNAME=admin
# DASHBOARD_PASSWORD_HASH=generated_hash_here
# DASHBOARD_PASSWORD_SALT=generated_salt_here

# Auto-Accept Settings
AUTO_ACCEPT_ENABLED=false
AUTO_ACCEPT_HOURS_IN_FUTURE=48
AUTO_ACCEPT_LOG_ONLY=false
AUTO_ACCEPT_SCHOOLS=WASHINGTON HIGH SCHOOL,AMERICAN HIGH SCHOOL,HORNER MIDDLE SCHOOL

# Check Interval (milliseconds)
CHECK_INTERVAL=60000
REAL_TIME_MODE=false
REAL_TIME_INTERVAL=30000

# Public URL
PUBLIC_URL=http://34.71.197.190:3000
EOF
    print_warning "Environment file created at $SERVICE_DIR/.env"
    print_warning "Please edit this file with your actual credentials"
fi

# Set proper permissions
echo -e "${BLUE}🔒 Setting permissions...${NC}"
sudo chown -R $USER:$USER $SERVICE_DIR
sudo chown -R $USER:$USER $LOG_DIR
sudo chmod +x $SERVICE_DIR/*.js

# Create systemd service
echo -e "${BLUE}⚙️  Creating systemd service...${NC}"
sudo tee $SYSTEMD_SERVICE > /dev/null <<EOF
[Unit]
Description=Aesop Shift Checker Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SERVICE_DIR
Environment=NODE_ENV=production
Environment=PATH=/usr/bin:/usr/local/bin
ExecStart=/usr/bin/node $SERVICE_DIR/aesop-checker.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=aesop-checker

# Environment file
EnvironmentFile=$SERVICE_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

# Configure firewall
echo -e "${BLUE}🔥 Configuring firewall...${NC}"
if command -v ufw &> /dev/null; then
    sudo ufw allow $SERVICE_PORT/tcp
    sudo ufw --force enable
    print_status "Firewall configured with UFW"
elif command -v firewall-cmd &> /dev/null; then
    sudo firewall-cmd --permanent --add-port=$SERVICE_PORT/tcp
    sudo firewall-cmd --reload
    print_status "Firewall configured with firewalld"
else
    print_warning "No firewall detected, please manually open port $SERVICE_PORT"
fi

# Create Google Cloud firewall rule (if gcloud is available)
if command -v gcloud &> /dev/null; then
    echo -e "${BLUE}☁️  Creating Google Cloud firewall rule...${NC}"
    gcloud compute firewall-rules create allow-aesop-port-3000 \
        --allow tcp:$SERVICE_PORT \
        --source-ranges 0.0.0.0/0 \
        --description "Allow Aesop Shift Checker port $SERVICE_PORT" \
        --quiet || print_warning "Could not create GCP firewall rule (may already exist)"
fi

# Enable and start service
echo -e "${BLUE}🚀 Enabling and starting service...${NC}"
sudo systemctl daemon-reload
sudo systemctl enable aesop-checker
sudo systemctl start aesop-checker

# Wait a moment for service to start
sleep 3

# Check service status
echo -e "${BLUE}📊 Checking service status...${NC}"
if sudo systemctl is-active --quiet aesop-checker; then
    print_status "Service is running!"
    
    # Show service details
    echo -e "${BLUE}📋 Service Details:${NC}"
    echo "Service Name: $SERVICE_NAME"
    echo "Port: $SERVICE_PORT"
    echo "External IP: 34.71.197.190"
    echo "Service URL: http://34.71.197.190:$SERVICE_PORT"
    echo "Health Check: http://34.71.197.190:$SERVICE_PORT/health/detailed"
    echo "API Endpoint: http://34.71.197.190:$SERVICE_PORT/api/shifts"
    
    # Test connectivity
    echo -e "${BLUE}🔍 Testing connectivity...${NC}"
    if curl -s -f http://localhost:$SERVICE_PORT/health/detailed > /dev/null; then
        print_status "Local connectivity test passed"
    else
        print_warning "Local connectivity test failed - check logs"
    fi
    
    # Show logs
    echo -e "${BLUE}📝 Recent service logs:${NC}"
    sudo journalctl -u aesop-checker --no-pager -n 10
    
else
    print_error "Service failed to start!"
    echo -e "${BLUE}📝 Service logs:${NC}"
    sudo journalctl -u aesop-checker --no-pager -n 20
    echo -e "${BLUE}🔧 To troubleshoot:${NC}"
    echo "1. Check the environment file: $SERVICE_DIR/.env"
    echo "2. View full logs: sudo journalctl -u aesop-checker -f"
    echo "3. Check service status: sudo systemctl status aesop-checker"
    echo "4. Restart service: sudo systemctl restart aesop-checker"
fi

echo -e "${BLUE}🎉 Setup complete!${NC}"
echo -e "${GREEN}React Native app should now connect to: http://34.71.197.190:$SERVICE_PORT/api/shifts${NC}"
