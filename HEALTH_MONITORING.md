# Health Monitoring and Notification System

## Overview

The Aesop Shift Checker includes a comprehensive health monitoring system that automatically checks the application status and sends email notifications when issues are detected.

## Components

### 1. Health Check Script (`health-check.sh`)
- **Purpose**: Performs comprehensive health checks
- **Exit Codes**: 0=Healthy, 1=Warning, 2=Error
- **Features**: 8-point monitoring system
- **Usage**: `aesop-health-check`

### 2. Health Monitor Script (`health-monitor.sh`)
- **Purpose**: Runs health checks and sends email notifications
- **Notifications**: Sends emails on WARNING and ERROR status
- **Logging**: Maintains monitoring log file
- **Usage**: `aesop-health-monitor`

### 3. Deployment Scripts
- **deploy-health-check.sh**: Deploys health check system
- **deploy-health-monitor.sh**: Deploys monitoring with notifications
- **setup-monitoring-cron.sh**: Sets up automated cron monitoring

## Notification Methods

### 📧 Email Notifications

**Automatic Email Alerts:**
- **Trigger**: WARNING (exit code 1) or ERROR (exit code 2)
- **Recipient**: `kjagpal75@gmail.com`
- **Content**: Detailed health check results with HTML formatting
- **Frequency**: Only when issues are detected (no spam for healthy status)

**Email Contents:**
- Health status (Healthy/Warning/Error)
- Detailed health check output
- Timestamp and server information
- Direct link to dashboard

**No Notification For:**
- ✅ Healthy status (exit code 0) - to avoid email spam

## Setup Instructions

### 1. Deploy Health Check System
```bash
./deploy-health-check.sh
```

### 2. Deploy Monitoring with Notifications
```bash
./deploy-health-monitor.sh
```

### 3. Setup Automated Monitoring
```bash
./setup-monitoring-cron.sh
```

## Usage Examples

### Manual Health Check
```bash
# Run health check (no notifications)
aesop-health-check

# Check exit code
echo $?  # 0=healthy, 1=warning, 2=error
```

### Manual Monitoring with Notifications
```bash
# Run monitoring with email notifications
aesop-health-monitor

# Check monitoring logs
tail -f /home/kuljitjagpal/aesop-checker/health-monitor.log
```

### Automated Monitoring
```bash
# Setup cron for every 5 minutes
./setup-monitoring-cron.sh

# Or manually add to crontab
crontab -e
# Add: */5 * * * * /usr/local/bin/aesop-health-monitor
```

## Monitoring Schedule Options

### Frequent Monitoring (Recommended for Production)
```bash
# Every 5 minutes
*/5 * * * * /usr/local/bin/aesop-health-monitor
```

### Moderate Monitoring
```bash
# Every 15 minutes
*/15 * * * * /usr/local/bin/aesop-health-monitor
```

### Light Monitoring
```bash
# Every 30 minutes
*/30 * * * * /usr/local/bin/aesop-health-monitor
```

### Hourly Monitoring
```bash
# Every hour
0 * * * * /usr/local/bin/aesop-health-monitor
```

## Health Check Details

### What Gets Monitored

1. **Process Status**
   - App is running (PID check)
   - Process uptime
   - Process age validation

2. **Dashboard Status**
   - HTTP accessibility (port 3000)
   - Response code validation
   - Connection timeout handling

3. **Log File Status**
   - Log file existence
   - File size monitoring (50MB threshold)
   - Recent error count analysis

4. **Memory Usage**
   - App memory usage (800MB threshold)
   - Chrome process memory (600MB threshold)
   - System memory percentage

5. **Chrome Processes**
   - Process count validation (20 max)
   - Orphaned process detection
   - Process relationship verification

6. **Recent Activity**
   - Job checking activity
   - Recent log entries
   - Application responsiveness

7. **System Resources**
   - System memory usage
   - Disk space monitoring
   - Resource threshold alerts

8. **Overall Health**
   - Comprehensive status summary
   - Issue count tracking
   - Severity classification

### Alert Thresholds

| Metric | Warning | Error |
|---------|---------|-------|
| App Memory | >400MB | >800MB |
| Chrome Memory | >600MB | N/A |
| Log File Size | >50MB | N/A |
| Chrome Processes | >20 | N/A |
| System Memory | >80% | >90% |
| Disk Usage | >80% | >90% |
| Recent Errors | >5 | N/A |

## Troubleshooting

### Check Health Status
```bash
# Run manual health check
aesop-health-check

# Check monitoring logs
tail -50 /home/kuljitjagpal/aesop-checker/health-monitor.log
```

### Test Email Notifications
```bash
# Force a warning to test email
# (Temporarily modify health check to return exit code 1)
aesop-health-monitor

# Check if email was sent
grep "notification" /home/kuljitjagpal/aesop-checker/health-monitor.log
```

### Modify Notification Settings
```bash
# Edit email recipient
vim /usr/local/bin/aesop-health-monitor
# Change ALERT_EMAIL variable

# Redeploy
./deploy-health-monitor.sh
```

### Cron Job Issues
```bash
# Check cron service
sudo systemctl status cron

# View cron logs
sudo tail -f /var/log/cron.log

# Test cron job manually
/usr/local/bin/aesop-health-monitor
```

### Disable Monitoring
```bash
# Remove cron jobs
crontab -l | grep -v 'aesop-health' | crontab -

# Or edit crontab
crontab -e
# Remove the aesop-health line
```

## Integration with Monitoring Systems

### Prometheus/Grafana
```bash
# Create metrics endpoint
# Add to aesop-checker.js to expose /metrics endpoint
# Health check results as metrics
```

### Slack/Teams Notifications
```bash
# Modify health-monitor.sh to send webhook notifications
# Add Slack/Teams integration alongside email
```

### PagerDuty Integration
```bash
# Add PagerDuty webhook for ERROR status
# Critical alerts trigger incident creation
```

## Best Practices

1. **Start with moderate monitoring frequency** (every 15-30 minutes)
2. **Adjust based on alert volume** - too many alerts = increase frequency
3. **Monitor the monitoring** - check health-monitor.log regularly
4. **Test notifications** - verify email delivery works
5. **Document changes** - keep this file updated with any modifications
6. **Backup configuration** - save cron jobs and notification settings

## File Locations

- **Health Check**: `/usr/local/bin/aesop-health-check`
- **Health Monitor**: `/usr/local/bin/aesop-health-monitor`
- **App Logs**: `/home/kuljitjagpal/aesop-checker/app.log`
- **Monitor Logs**: `/home/kuljitjagpal/aesop-checker/health-monitor.log`
- **Config**: `/home/kuljitjagpal/aesop-checker/config.js`

## Support

For issues with the health monitoring system:

1. Check the health monitor logs first
2. Run manual health check to verify functionality
3. Test email notifications separately
4. Verify cron job configuration
5. Check system resources (memory, disk space)

The health monitoring system is designed to be proactive and help you maintain high availability for the Aesop Shift Checker application.
