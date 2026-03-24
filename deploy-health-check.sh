#!/bin/bash

# Deploy Health Check Script to Production Server
# This script installs and configures the health check monitoring

set -e

echo "🚀 Deploying Health Check Script..."

# Copy health check script to server
echo "📤 Copying health check script..."
gcloud compute scp health-check.sh aesop-server:/tmp/health-check.sh

# Move to proper location and set permissions
echo "📁 Installing health check script..."
gcloud compute ssh aesop-server --command "sudo mv /tmp/health-check.sh /usr/local/bin/aesop-health-check && sudo chmod +x /usr/local/bin/aesop-health-check"

# Test the health check
echo "🧪 Testing health check..."
gcloud compute ssh aesop-server --command "aesop-health-check"

echo ""
echo "✅ Health check script deployed successfully!"
echo ""
echo "📋 Usage:"
echo "  Run manually: aesop-health-check"
echo "  Check exit code: echo \$? (0=healthy, 1=warning, 2=error)"
echo ""
echo "🔧 Integration ideas:"
echo "  - Add to cron: */5 * * * * /usr/local/bin/aesop-health-check"
echo "  - Use in monitoring systems"
echo "  - Create alerts based on exit codes"
