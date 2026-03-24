#!/bin/bash

# Setup Cron Jobs for Health Monitoring
# This script configures automated health monitoring

set -e

echo "⏰ Setting up Health Monitoring Cron Jobs..."

# Check if crontab exists
if ! crontab -l 2>/dev/null | grep -q "aesop-health"; then
    echo "📝 Adding health monitoring cron jobs..."
    
    # Create new crontab with health monitoring
    (crontab -l 2>/dev/null; echo "# Aesop Health Monitoring"; echo "*/5 * * * * /usr/local/bin/aesop-health-monitor") | crontab -
    
    echo "✅ Added health monitoring cron job (every 5 minutes)"
else
    echo "ℹ️  Health monitoring cron job already exists"
fi

# Show current crontab
echo ""
echo "📋 Current cron jobs:"
crontab -l | grep -A5 -B5 "aesop-health" || echo "No aesop-health cron jobs found"

echo ""
echo "⚙️  Cron Job Details:"
echo "  Schedule: */5 * * * * (every 5 minutes)"
echo "  Command: /usr/local/bin/aesop-health-monitor"
echo "  Action: Runs health check and sends email on warnings/errors"
echo ""
echo "🔧 To modify schedule:"
echo "  Edit crontab: crontab -e"
echo "  Remove cron: crontab -l | grep -v 'aesop-health' | crontab -"
echo ""
echo "📊 To view monitoring logs:"
echo "  tail -f /home/kuljitjagpal/aesop-checker/health-monitor.log"

echo ""
echo "✅ Health monitoring cron setup completed!"
