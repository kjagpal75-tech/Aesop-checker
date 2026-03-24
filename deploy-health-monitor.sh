#!/bin/bash

# Deploy Health Monitor with Email Notifications
# This script installs and configures the health monitoring system

set -e

echo "🚀 Deploying Health Monitor with Notifications..."

# Copy scripts to server
echo "📤 Copying health monitor scripts..."
gcloud compute scp health-monitor.sh aesop-server:/tmp/health-monitor.sh

# Install health monitor
echo "📁 Installing health monitor..."
gcloud compute ssh aesop-server --command "sudo mv /tmp/health-monitor.sh /usr/local/bin/aesop-health-monitor && sudo chmod +x /usr/local/bin/aesop-health-monitor"

# Test the health monitor
echo "🧪 Testing health monitor..."
gcloud compute ssh aesop-server --command "aesop-health-monitor"

echo ""
echo "✅ Health monitor deployed successfully!"
echo ""
echo "📋 Usage:"
echo "  Run manually: aesop-health-monitor"
echo "  Check logs: tail -f /home/kuljitjagpal/aesop-checker/health-monitor.log"
echo ""
echo "🔧 Notification Setup:"
echo "  ✅ Email notifications configured to: kjagpal75@gmail.com"
echo "  ✅ Sends alerts on WARNING and ERROR status"
echo "  ✅ Includes detailed health check results"
echo ""
echo "⏰ Automation Options:"
echo "  # Add to cron for every 5 minutes with notifications:"
echo "  */5 * * * * /usr/local/bin/aesop-health-monitor"
echo ""
echo "  # Add to cron for every 30 minutes (less frequent):"
echo "  */30 * * * * /usr/local/bin/aesop-health-monitor"
echo ""
echo "📧 Notification Types:"
echo "  🟢 HEALTHY (exit code 0) - No notification sent"
echo "  🟡 WARNING (exit code 1) - Email notification sent"
echo "  🔴 ERROR (exit code 2) - Email notification sent"
echo ""
echo "🔍 Troubleshooting:"
echo "  - Check health monitor logs: /home/kuljitjagpal/aesop-checker/health-monitor.log"
echo "  - Run health check manually: aesop-health-check"
echo "  - Test email: node -e \"console.log('Email test')\" | mail -s test kjagpal75@gmail.com"
