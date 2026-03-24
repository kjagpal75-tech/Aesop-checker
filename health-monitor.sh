#!/bin/bash

# Health Monitor with Email Notifications
# This script runs health checks and sends notifications when issues are detected

set -e

# Configuration
HEALTH_CHECK="/usr/local/bin/aesop-health-check"
LOG_FILE="/home/kuljitjagpal/aesop-checker/health-monitor.log"
ALERT_EMAIL="kjagpal75@gmail.com"
APP_DIR="/home/kuljitjagpal/aesop-checker"

# Email configuration (load from app config)
source "$APP_DIR/config.js" 2>/dev/null || {
    EMAIL_FROM="kjagpal75@gmail.com"
    EMAIL_PASSWORD="zosc tvbd yhdo cccb"
}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Aesop Health Monitor with Notifications${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# Function to send email notification
send_notification() {
    local status=$1
    local message=$2
    local details=$3
    
    echo "📧 Sending health notification: $status"
    
    # Create email content
    local email_subject="🏥 Aesop Health Monitor: $status"
    local email_body=$(cat << EOF
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Aesop Health Monitor Alert</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; }
        .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f8f9fa; }
        .status { padding: 15px; border-radius: 8px; margin: 10px 0; }
        .status.error { background: #fee2e2; border-left: 4px solid #dc2626; }
        .status.warning { background: #fef3c7; border-left: 4px solid #f59e0b; }
        .status.healthy { background: #dcfce7; border-left: 4px solid #16a34a; }
        .details { background: white; padding: 15px; border-radius: 8px; margin: 10px 0; }
        .footer { background: #1f2937; color: white; padding: 15px; text-align: center; font-size: 12px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🏥 Aesop Health Monitor</h1>
        <p>Automated Health Check Alert</p>
    </div>
    
    <div class="content">
        <div class="status $status">
            <h2>Status: $status</h2>
            <p>$message</p>
        </div>
        
        <div class="details">
            <h3>📊 Health Check Details:</h3>
            <pre style="background: #f1f5f9; padding: 10px; border-radius: 4px; overflow-x: auto;">$details</pre>
        </div>
        
        <div class="details">
            <h3>🕐 Timestamp:</h3>
            <p>$(date)</p>
            
            <h3>🖥️ Server Information:</h3>
            <p>Server: aesop-server (Google Cloud VM)</p>
            <p>Application: Aesop Shift Checker</p>
            <p>Dashboard: http://34.71.197.190:3000</p>
        </div>
    </div>
    
    <div class="footer">
        <p>Aesop Health Monitor - Automated System Monitoring</p>
        <p>This alert was generated automatically. Please check the system status.</p>
    </div>
</body>
</html>
EOF
)
    
    # Send email using nodemailer (similar to app's email system)
    node -e "
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
        user: '$EMAIL_FROM',
        pass: '$EMAIL_PASSWORD'
    }
});

const mailOptions = {
    from: '$EMAIL_FROM',
    to: '$ALERT_EMAIL',
    subject: '$email_subject',
    html: \`$email_body\`
};

transporter.sendMail(mailOptions)
    .then(() => console.log('✅ Health notification email sent successfully'))
    .catch(err => console.error('❌ Error sending health notification:', err));
" 2>/dev/null || {
        echo "❌ Failed to send email notification"
    }
}

# Function to log to file
log_message() {
    local message=$1
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $message" >> "$LOG_FILE"
}

# Run health check
echo "🏥 Running health check..."
HEALTH_OUTPUT=$($HEALTH_CHECK 2>&1)
HEALTH_EXIT_CODE=$?

# Log the result
log_message "Health check completed with exit code: $HEALTH_EXIT_CODE"
log_message "Health check output:"
log_message "$HEALTH_OUTPUT"

# Determine status and notification needs
case $HEALTH_EXIT_CODE in
    0)
        STATUS="healthy"
        EMOJI="✅"
        MESSAGE="All systems operational"
        echo -e "${GREEN}✅ Health Status: HEALTHY${NC}"
        echo -e "${GREEN}   All systems operational${NC}"
        log_message "Status: HEALTHY - No action needed"
        ;;
    1)
        STATUS="warning"
        EMOJI="⚠️"
        MESSAGE="Warning conditions detected - monitor closely"
        echo -e "${YELLOW}⚠️  Health Status: WARNING${NC}"
        echo -e "${YELLOW}   Warning conditions detected${NC}"
        log_message "Status: WARNING - Monitor closely"
        ;;
    2)
        STATUS="error"
        EMOJI="❌"
        MESSAGE="Critical issues detected - immediate attention required"
        echo -e "${RED}❌ Health Status: ERROR${NC}"
        echo -e "${RED}   Critical issues detected${NC}"
        log_message "Status: ERROR - Immediate attention required"
        ;;
    *)
        STATUS="error"
        EMOJI="💥"
        MESSAGE="Health check failed to run properly"
        echo -e "${RED}💥 Health Status: UNKNOWN${NC}"
        echo -e "${RED}   Health check failed${NC}"
        log_message "Status: UNKNOWN - Health check failed"
        ;;
esac

# Send notification if not healthy
if [ "$HEALTH_EXIT_CODE" -ne 0 ]; then
    echo ""
    echo "📧 Sending notification..."
    send_notification "$STATUS" "$MESSAGE" "$HEALTH_OUTPUT"
    echo ""
    echo "📧 Notification sent to: $ALERT_EMAIL"
else
    echo ""
    echo "✅ No notification needed (system is healthy)"
fi

echo ""
echo -e "${BLUE}Health monitor completed at: $(date)${NC}"
echo -e "${BLUE}Log file: $LOG_FILE${NC}"

# Exit with same code as health check
exit $HEALTH_EXIT_CODE
