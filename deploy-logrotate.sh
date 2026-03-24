#!/bin/bash

# Deploy logrotate configuration for Aesop Shift Checker
# This script deploys the logrotate configuration to the production server

set -e

echo "🔄 Deploying logrotate configuration..."

# Backup existing configuration
echo "📋 Backing up existing configuration..."
gcloud compute ssh aesop-server --command "sudo cp /etc/logrotate.d/aesop-checker /etc/logrotate.d/aesop-checker.backup.$(date +%Y%m%d_%H%M%S)" || echo "No existing config found"

# Deploy new configuration
echo "📤 Deploying new logrotate configuration..."
gcloud compute scp logrotate.conf aesop-server:/tmp/logrotate.conf
gcloud compute ssh aesop-server --command "sudo mv /tmp/logrotate.conf /etc/logrotate.d/aesop-checker"

# Set proper permissions
echo "🔐 Setting permissions..."
gcloud compute ssh aesop-server --command "sudo chmod 644 /etc/logrotate.d/aesop-checker"

# Test configuration
echo "🧪 Testing logrotate configuration..."
gcloud compute ssh aesop-server --command "sudo logrotate -d /etc/logrotate.d/aesop-checker"

echo "✅ Logrotate configuration deployed successfully!"
echo ""
echo "📋 Features:"
echo "  - Rotates when log reaches 10MB"
echo "  - Non-disruptive (copytruncate - no app restart)"
echo "  - Keeps 7 days of logs"
echo "  - Compresses old logs"
echo "  - Automatic cleanup"
echo ""
echo "🔍 To test manually: sudo logrotate -v /etc/logrotate.d/aesop-checker"
