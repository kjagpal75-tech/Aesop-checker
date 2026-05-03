#!/bin/bash

# HTTPS Setup Script for Aesop Shift Checker
# Sets up Nginx reverse proxy with SSL/HTTPS

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

echo -e "${BLUE}🔒 Setting up HTTPS for Aesop Shift Checker${NC}"

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root"
   exit 1
fi

# Update system
echo -e "${BLUE}📦 Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y

# Install Nginx
echo -e "${BLUE}🌐 Installing Nginx...${NC}"
sudo apt install -y nginx

# Install Certbot for SSL certificates
echo -e "${BLUE}🔐 Installing Certbot for SSL...${NC}"
sudo apt install -y certbot python3-certbot-nginx

# Create Nginx configuration
echo -e "${BLUE}⚙️  Creating Nginx configuration...${NC}"
sudo tee /etc/nginx/sites-available/aesop-checker > /dev/null <<'EOF'
server {
    listen 80;
    server_name 34.71.197.190;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name 34.71.197.190;

    # SSL Configuration (will be completed by Certbot)
    # ssl_certificate /etc/letsencrypt/live/34.71.197.190/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/34.71.197.190/privkey.pem;

    # SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Proxy to Node.js backend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
}
EOF

# Enable the site
echo -e "${BLUE}🔗 Enabling Nginx site...${NC}"
sudo ln -sf /etc/nginx/sites-available/aesop-checker /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
echo -e "${BLUE}🧪 Testing Nginx configuration...${NC}"
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx

# Open firewall ports
echo -e "${BLUE}🔥 Opening HTTPS ports...${NC}"
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Create GCP firewall rules
if command -v gcloud &> /dev/null; then
    echo -e "${BLUE}☁️  Creating GCP firewall rules...${NC}"
    gcloud compute firewall-rules create allow-aesop-http \
        --allow tcp:80 \
        --source-ranges 0.0.0.0/0 \
        --description "Allow Aesop HTTP" \
        --quiet 2>/dev/null || true
    
    gcloud compute firewall-rules create allow-aesop-https \
        --allow tcp:443 \
        --source-ranges 0.0.0.0/0 \
        --description "Allow Aesop HTTPS" \
        --quiet 2>/dev/null || true
fi

# Get SSL certificate
echo -e "${BLUE}🔐 Getting SSL certificate...${NC}"
sudo certbot --nginx -d 34.71.197.190 --non-interactive --agree-tos --email admin@34.71.197.190 --redirect

# Setup auto-renewal
echo -e "${BLUE}🔄 Setting up SSL auto-renewal...${NC}"
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Test the setup
echo -e "${BLUE}🔍 Testing HTTPS setup...${NC}"
if curl -s -f https://34.71.197.190/health/detailed > /dev/null; then
    print_status "HTTPS is working!"
else
    print_warning "HTTPS test failed - backend may not be running yet"
fi

print_status "HTTPS setup complete!"
echo ""
echo -e "${BLUE}📋 Service Information:${NC}"
echo "HTTP (redirects to HTTPS): http://34.71.197.190"
echo "HTTPS: https://34.71.197.190"
echo "API Endpoint: https://34.71.197.190/api/shifts"
echo "Health Check: https://34.71.197.190/health/detailed"
echo ""
echo -e "${GREEN}React Native app can now connect to: https://34.71.197.190/api/shifts${NC}"
echo ""
echo -e "${BLUE}📝 SSL Certificate Info:${NC}"
echo "Certificate location: /etc/letsencrypt/live/34.71.197.190/"
echo "Auto-renewal: Enabled (systemd timer)"
echo "Renewal command: sudo certbot renew"
echo ""
echo -e "${BLUE}🔧 Management Commands:${NC}"
echo "Restart Nginx: sudo systemctl restart nginx"
echo "Check Nginx status: sudo systemctl status nginx"
echo "View Nginx logs: sudo journalctl -u nginx -f"
echo "Renew SSL: sudo certbot renew"
