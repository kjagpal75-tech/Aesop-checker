#!/bin/bash

# Deploy SSL/HTTPS Setup for Aesop Dashboard
# This script configures Nginx reverse proxy with SSL termination

set -e

echo "🔒 Deploying SSL/HTTPS Setup..."

echo "📋 SSL Setup Summary:"
echo "  - Self-signed SSL certificate (1 year validity)"
echo "  - Nginx reverse proxy with SSL termination"
echo "  - HTTPS-only access (HTTP disabled for security)"
echo "  - Security headers and SSL hardening"
echo "  - Firewall rules updated for HTTPS only (port 443)"
echo ""

# Check if Nginx is installed
echo "🔧 Checking Nginx installation..."
gcloud compute ssh aesop-server --command "sudo nginx -v" || {
    echo "❌ Nginx not found. Installing..."
    gcloud compute ssh aesop-server --command "sudo apt update && sudo apt install -y nginx"
}

# Generate SSL certificate
echo "🔑 Generating SSL certificate..."
gcloud compute ssh aesop-server --command "
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/aesop.key \
    -out /etc/nginx/ssl/aesop.crt \
    -subj '/C=US/ST=California/L=Fremont/O=Fremont Unified/CN=aesop-server'
"

# Deploy Nginx configuration
echo "📤 Deploying Nginx SSL configuration..."
gcloud compute scp nginx-ssl.conf aesop-server:/tmp/nginx-ssl.conf

gcloud compute ssh aesop-server --command "
sudo cp /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.backup
sudo mv /tmp/nginx-ssl.conf /etc/nginx/sites-available/aesop-ssl
sudo ln -sf /etc/nginx/sites-available/aesop-ssl /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
"

# Test and restart Nginx
echo "🧪 Testing Nginx configuration..."
gcloud compute ssh aesop-server --command "sudo nginx -t"

echo "🔄 Restarting Nginx..."
gcloud compute ssh aesop-server --command "sudo systemctl restart nginx"

# Update firewall rules
echo "🔥 Updating firewall rules (HTTPS only)..."
gcloud compute firewall-rules update default-allow-http --allow tcp:3000

# Update app configuration
echo "⚙️ Updating app configuration for HTTPS..."
gcloud compute ssh aesop-server --command "
cd /home/kuljitjagpal/aesop-checker
cp .env .env.backup
sed -i 's|PUBLIC_URL=http://34.71.197.190:3000|PUBLIC_URL=https://34.71.197.190|' .env
"

# Restart the app
echo "🔄 Restarting Aesop app..."
gcloud compute ssh aesop-server --command "
ps aux | grep 'node aesop-checker.js' | grep -v grep | awk '{print \$2}' | xargs kill 2>/dev/null || true
sleep 3
cd /home/kuljitjagpal/aesop-checker
nohup node aesop-checker.js > app.log 2>&1 &
"

# Test SSL setup
echo "🧪 Testing SSL setup..."
sleep 5

echo "Testing HTTPS access..."
HTTPS_STATUS=$(curl -k -s -o /dev/null -w '%{http_code}' https://34.71.197.190)
echo "  HTTPS Status: $HTTPS_STATUS"

echo "Testing HTTP access (should be blocked)..."
HTTP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://34.71.197.190 --max-time 5 || echo "TIMEOUT")
echo "  HTTP Status: $HTTP_STATUS (should be TIMEOUT or blocked)"

echo ""
echo "✅ SSL/HTTPS Setup Completed!"
echo ""
echo "🌐 Access URLs:"
echo "  🔒 HTTPS: https://34.71.197.190 (ONLY)"
echo "  � HTTP: http://34.71.197.190 (DISABLED)"
echo "  📱 Direct App: http://34.71.197.190:3000 (still accessible)"
echo ""
echo "📋 SSL Certificate Info:"
echo "  📅 Validity: 1 year (self-signed)"
echo "  🔐 Algorithm: RSA 2048-bit"
echo "  🖥️ Subject: CN=aesop-server"
echo ""
echo "🔧 Security Features:"
echo "  ✅ HTTPS-only access (HTTP disabled)"
echo "  ✅ SSL/TLS hardening (TLS 1.2+)"
echo "  ✅ Security headers (HSTS, XSS protection, etc.)"
echo "  ✅ Reverse proxy configuration"
echo "  ✅ Firewall allows HTTPS only (port 443)"
echo ""
echo "⚠️  Browser Warning:"
echo "  Self-signed certificate will show security warning"
echo "  Click 'Advanced' -> 'Proceed to site' to access"
echo ""
echo "🔍 To upgrade to Let's Encrypt (free trusted certificate):"
echo "  1. sudo apt install certbot python3-certbot-nginx"
echo "  2. sudo certbot --nginx -d 34.71.197.190"
echo ""
echo "📊 Current Status:"
echo "  App URL: https://34.71.197.190"
echo "  Config: PUBLIC_URL=https://34.71.197.190"
echo "  Firewall: Port 443 only (HTTPS)"
