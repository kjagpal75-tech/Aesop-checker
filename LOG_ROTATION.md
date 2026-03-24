# Log Rotation Configuration

## Overview

The Aesop Shift Checker uses a non-disruptive log rotation system that rotates logs when they reach 10MB without restarting the application.

## Features

- ✅ **Non-disruptive**: Uses `copytruncate` method - no app restart required
- ✅ **Size-based**: Rotates when log reaches 10MB
- ✅ **Automatic cleanup**: Keeps 7 days of logs
- ✅ **Compressed archives**: Saves disk space with gzip compression
- ✅ **Safe operations**: Won't rotate empty logs or missing files

## Configuration

### File Location
- **Production**: `/etc/logrotate.d/aesop-checker`
- **Repository**: `logrotate.conf`

### Settings
```bash
/home/kuljitjagpal/aesop-checker/app.log {
    size 10M              # Rotate when log reaches 10MB
    rotate 7              # Keep 7 days of logs
    notifempty            # Don't rotate empty logs
    missingok             # Don't error if log file is missing
    compress              # Compress old logs
    delaycompress         # Don't compress the most recent log
    create 644 kuljitjagpal kuljitjagpal  # Set proper permissions
    copytruncate          # Non-disruptive rotation
    maxage 7              # Remove logs older than 7 days
}
```

## How It Works

1. When `app.log` reaches 10MB:
   - Copies current log to `app.log.1`
   - Truncates (empties) original `app.log`
   - App continues writing to same file descriptor
   - No restart required

2. Previous logs are rotated:
   - `app.log.1` → `app.log.2.gz`
   - `app.log.2.gz` → `app.log.3.gz`
   - And so on...

3. Logs older than 7 days are automatically deleted

## Deployment

### Automatic Deployment
```bash
./deploy-logrotate.sh
```

### Manual Deployment
```bash
# Copy configuration to server
gcloud compute scp logrotate.conf aesop-server:/tmp/
gcloud compute ssh aesop-server --command "sudo mv /tmp/logrotate.conf /etc/logrotate.d/aesop-checker"

# Test configuration
sudo logrotate -d /etc/logrotate.d/aesop-checker
```

## Testing

### Test Configuration Syntax
```bash
sudo logrotate -d /etc/logrotate.d/aesop-checker
```

### Test with Verbose Output
```bash
sudo logrotate -v /etc/logrotate.d/aesop-checker
```

### Force Test Rotation (won't rotate if under size threshold)
```bash
sudo logrotate -f /etc/logrotate.d/aesop-checker
```

## Benefits

- **Zero downtime**: App never stops during rotation
- **No missed jobs**: Continuous monitoring
- **Disk space optimization**: Compressed archives
- **Automatic cleanup**: Prevents disk space issues
- **Reliable**: Handles missing files gracefully

## Troubleshooting

### Check if logrotate is running
```bash
ps aux | grep logrotate
```

### Check last rotation
```bash
ls -la /home/kuljitjagpal/aesop-checker/app.log*
```

### Check logrotate status
```bash
cat /var/lib/logrotate/status | grep aesop-checker
```

### Manual rotation test
```bash
# Create a large log file to test rotation
dd if=/dev/zero of=/home/kuljitjagpal/aesop-checker/app.log bs=1M count=11
sudo logrotate -v /etc/logrotate.d/aesop-checker
```

## Migration from Old Configuration

The previous configuration restarted the application during rotation, causing service interruptions. The new configuration uses `copytruncate` to avoid this issue.

**Old behavior:**
- Daily rotation at midnight
- App restart required
- Service interruption during restart
- Potential missed job postings

**New behavior:**
- Size-based rotation (10MB)
- No app restart
- Zero service interruption
- Continuous job monitoring
