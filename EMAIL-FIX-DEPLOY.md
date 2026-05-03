# Email Configuration Fix - Manual Deployment

## Problem
- `hkjagpal@hotmail.com` is receiving error messages (should not)
- Need `kjagpal75@gmail.com` to receive ALL messages
- Need `hkjagpal@hotmail.com` to receive ONLY job availability and auto-accept emails

## Solution
I've updated the email routing in `aesop-checker.js` with these changes:

### 1. Error Notifications (Line ~1082)
**BEFORE**: `to: CONFIG.emailTo`
**AFTER**: `to: 'kjagpal75@gmail.com'` // Error notifications only to kjagpal75@gmail.com

### 2. Job Notifications (Line ~1009)
**BEFORE**: Dynamic recipients based on config
**AFTER**: `const recipients = ['kjagpal75@gmail.com', 'hkjagpal@hotmail.com'];`

### 3. Auto-Accept Notifications (Line ~1134)
**BEFORE**: `to: 'kjagpal75@gmail.com'`
**AFTER**: `to: 'kjagpal75@gmail.com, hkjagpal@hotmail.com'`

## Manual Deployment Steps

### Option 1: Use Google Cloud Console SSH
1. Go to Google Cloud Console
2. Navigate to Compute Engine > VM instances
3. Click "SSH" button for `aesop-server`
4. Run these commands in the browser SSH:

```bash
# Switch to service user
sudo -u kjagpal75 bash -c 'cd /home/kjagpal75/Aesop-checker'

# Backup current file
cp aesop-checker.js aesop-checker.js.backup

# Create the updated file with email fixes
cat > aesop-checker.js << 'EOF'
[PASTE THE ENTIRE UPDATED aesop-checker.js CONTENT HERE]
EOF

# Restart the service
pkill -f "node.*aesop-checker" 2>/dev/null || true
sleep 2
nohup node aesop-checker.js > aesop-checker.log 2>&1 &
echo $! > aesop-checker.pid

# Check if service is running
ps aux | grep aesop-checker
```

### Option 2: Copy Updated File
If you can establish SSH connection:

```bash
# Copy updated file to VM
gcloud compute scp aesop-checker/aesop-checker.js aesop-server:~/aesop-checker.js

# Move to correct location and set permissions
gcloud compute ssh aesop-server --command "sudo mv ~/aesop-checker.js /home/kjagpal75/Aesop-checker/aesop-checker.js && sudo chown kjagpal75:kjagpal75 /home/kjagpal75/Aesop-checker/aesop-checker.js"

# Restart service
gcloud compute ssh aesop-server --command "sudo -u kjagpal75 pkill -f 'node.*aesop-checker' && sleep 2 && sudo -u kjagpal75 -H bash -c 'cd /home/kjagpal75/Aesop-checker && nohup node aesop-checker.js > aesop-checker.log 2>&1 & echo \$! > aesop-checker.pid'"
```

## Email Routing After Fix

### ✅ kjagpal75@gmail.com receives:
- Error notifications
- Job availability notifications  
- Auto-accept notifications

### ✅ hkjagpal@hotmail.com receives:
- Job availability notifications
- Auto-accept notifications

### ❌ hkjagpal@hotmail.com does NOT receive:
- Error notifications

## Testing the Fix

After deployment, you can test the email routing:

1. **Test Error Email**: Trigger an error (e.g., invalid credentials in .env)
2. **Test Job Notification**: Wait for new jobs or use debug endpoint
3. **Check Email Recipients**: Verify who receives each type of email

## Verification Commands

```bash
# Check service status
curl -k https://34.71.197.190/health/detailed

# Check recent logs
gcloud compute ssh aesop-server --command "sudo -u kjagpal75 tail -20 /home/kjagpal75/Aesop-checker/aesop-checker.log"

# Check email configuration in logs
gcloud compute ssh aesop-server --command "sudo -u kjagpal75 grep -i 'email.*recipient\|notification.*to' /home/kjagpal75/Aesop-checker/aesop-checker.log"
```

## Important Notes

- The updated `aesop-checker.js` file is in your local directory
- Make sure to restart the service after deployment
- Test each email type to verify correct routing
- Monitor logs for any email-related errors

The fix ensures proper email routing according to your requirements!
