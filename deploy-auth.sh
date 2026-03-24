#!/bin/bash

# Deploy Authentication System for Aesop Dashboard
# This script adds secure login protection to the dashboard

set -e

echo "🔐 Deploying Dashboard Authentication System..."

echo "📋 Authentication Features:"
echo "  - Secure login with username/password"
echo "  - Session-based authentication (24-hour sessions)"
echo "  - Failed attempt lockout (5 attempts, 15-minute lockout)"
echo "  - Secure cookie handling (HTTPS only)"
echo "  - Automatic session cleanup"
echo "  - Public health endpoint (no auth required)"
echo ""

# Check if auth middleware exists
if [ ! -f "auth-middleware.js" ]; then
    echo "❌ auth-middleware.js not found!"
    exit 1
fi

# Deploy files to server
echo "📤 Deploying authentication files..."
gcloud compute scp auth-middleware.js aesop-server:/home/kuljitjagpal/aesop-checker/
gcloud compute scp aesop-checker.js aesop-server:/home/kuljitjagpal/aesop-checker/
gcloud compute scp config.js aesop-server:/home/kuljitjagpal/aesop-checker/

# Create public directory if it doesn't exist
echo "📁 Ensuring public directory exists..."
gcloud compute ssh aesop-server --command "cd /home/kuljitjagpal/aesop-checker && mkdir -p public"

# Deploy login page
echo "📤 Deploying login page..."
gcloud compute scp public/login.html aesop-server:/home/kuljitjagpal/aesop-checker/public/

# Generate secure password hash for production
echo "🔑 Generating secure credentials..."
PASSWORD="Aesop@2026!"
HASH_RESULT=$(gcloud compute ssh aesop-server --command "
cd /home/kuljitjagpal/aesop-checker
node -e \"
const { hashPassword } = require('./auth-middleware');
const result = hashPassword('$PASSWORD');
console.log('HASH=' + result.hash);
console.log('SALT=' + result.salt);
\"
")

# Extract hash and salt
HASH=$(echo "$HASH_RESULT" | grep "HASH=" | cut -d'=' -f2)
SALT=$(echo "$HASH_RESULT" | grep "SALT=" | cut -d'=' -f2)

echo "Generated secure hash for default password"

# Update .env file with credentials
echo "⚙️ Updating configuration with secure credentials..."
gcloud compute ssh aesop-server --command "
cd /home/kuljitjagpal/aesop-checker
cp .env .env.backup.auth

# Add authentication credentials to .env
if ! grep -q 'DASHBOARD_USERNAME' .env; then
    echo '' >> .env
    echo '# Dashboard Authentication' >> .env
    echo 'DASHBOARD_USERNAME=admin' >> .env
    echo "DASHBOARD_PASSWORD_HASH=$HASH" >> .env
    echo "DASHBOARD_PASSWORD_SALT=$SALT" >> .env
fi
"

# Restart the app
echo "🔄 Restarting Aesop app with authentication..."
gcloud compute ssh aesop-server --command "
ps aux | grep 'node aesop-checker.js' | grep -v grep | awk '{print \$2}' | xargs kill 2>/dev/null || true
sleep 3
cd /home/kuljitjagpal/aesop-checker
nohup node aesop-checker.js > app.log 2>&1 &
"

# Test authentication setup
echo "🧪 Testing authentication setup..."
sleep 5

echo "Testing login page..."
LOGIN_STATUS=$(curl -k -s -o /dev/null -w '%{http_code}' https://34.71.197.190/login)
echo "  Login page status: $LOGIN_STATUS"

echo "Testing protected dashboard redirect..."
DASHBOARD_STATUS=$(curl -k -s -o /dev/null -w '%{http_code}' -L https://34.71.197.190/ | tail -1)
echo "  Dashboard redirect status: $DASHBOARD_STATUS"

echo "Testing public health endpoint..."
HEALTH_STATUS=$(curl -k -s -o /dev/null -w '%{http_code}' https://34.71.197.190/health)
echo "  Health endpoint status: $HEALTH_STATUS"

echo ""
echo "✅ Authentication System Deployed!"
echo ""
echo "🔐 Login Credentials:"
echo "  Username: admin"
echo "  Password: Aesop@2026!"
echo ""
echo "🌐 Access URLs:"
echo "  🔒 Login: https://34.71.197.190/login"
echo "  🏠 Dashboard: https://34.71.197.190 (requires login)"
echo "  ❤️ Health: https://34.71.197.190/health (public)"
echo ""
echo "🔧 Security Features:"
echo "  ✅ Session-based authentication (24-hour expiry)"
echo "  ✅ Failed attempt lockout (5 attempts, 15 min lockout)"
echo "  ✅ Secure cookies (HTTPS only, httpOnly, sameSite)"
echo "  ✅ Password hashing with PBKDF2 (10,000 iterations)"
echo "  ✅ Automatic session cleanup"
echo "  ✅ IP-based lockout protection"
echo ""
echo "🔍 To Change Credentials:"
echo "  1. Set DASHBOARD_USERNAME in .env file"
echo "  2. Generate new password hash:"
echo "     node -e \"const { hashPassword } = require('./auth-middleware'); console.log(hashPassword('YourNewPassword'));\""
echo "  3. Update DASHBOARD_PASSWORD_HASH and DASHBOARD_PASSWORD_SALT in .env"
echo "  4. Restart the app"
echo ""
echo "📱 Mobile Access:"
echo "  - Works on mobile browsers"
echo "  - Secure login with SSL"
echo "  - Responsive design"
echo ""
echo "⚠️  Security Notes:"
echo "  - Change default password before production use"
echo "  - Use strong passwords (min 8 chars, mixed case, numbers, symbols)"
echo "  - Consider using environment variables for credentials"
echo "  - Monitor failed login attempts in logs"

# Show current credentials
echo ""
echo "📋 Current Configuration:"
gcloud compute ssh aesop-server --command "
cd /home/kuljitjagpal/aesop-checker
echo 'Dashboard Username: ' \$(grep DASHBOARD_USERNAME .env | cut -d'=' -f2)
echo 'Password Hash: ' \$(grep DASHBOARD_PASSWORD_HASH .env | cut -d'=' -f2 | cut -c1-20)...
echo 'Password Salt: ' \$(grep DASHBOARD_PASSWORD_SALT .env | cut -d'=' -f2 | cut -c1-20)...
"
