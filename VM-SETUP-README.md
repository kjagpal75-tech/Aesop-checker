# Aesop Shift Checker VM Setup

This guide helps you set up and run the Aesop Shift Checker backend service on your Google Cloud VM.

## Quick Start (Recommended)

For immediate setup, use the quick-start script:

```bash
# SSH into your Google Cloud VM
gcloud compute ssh your-instance-name

# Navigate to the aesop-checker directory
cd /path/to/aesop-checker

# Run the quick-start script
./quick-start.sh
```

## What the Scripts Do

### 1. `quick-start.sh` - Immediate Service Start
- Installs Node.js dependencies
- Creates `.env` file template
- Opens port 3000 in firewall
- Creates Google Cloud firewall rule
- Starts the service in background
- Tests connectivity

### 2. `stop-service.sh` - Stop Service
- Stops the running service
- Cleans up PID file
- Kills any remaining processes

### 3. `restart-service.sh` - Restart Service
- Stops and restarts the service
- Uses the other scripts

### 4. `start-aesop-service.sh` - Full System Setup
- Complete system configuration
- Creates systemd service
- Sets up proper permissions
- Configures firewall
- Creates service that auto-starts on boot

## Before Running

### 1. Copy Files to VM
```bash
# From your local machine
gcloud compute scp --recurse /Users/kuljitjagpal/aesop-checker/* your-instance-name:~/aesop-checker/

# Or use git clone if your code is in a repository
git clone your-repository-url
```

### 2. Configure Environment
After running the script, edit the `.env` file:
```bash
nano .env
```

Required settings:
```env
# Aesop Login
AESOP_USERNAME=your_actual_username
AESOP_PASSWORD=your_actual_password

# Email (for notifications)
EMAIL_TO=your_email@example.com
EMAIL_FROM=your_email@gmail.com
EMAIL_PASSWORD=your_app_password_here
```

## Service URLs

Once running, your React Native app can connect to:

### With HTTPS (Recommended)
- **API Endpoint**: `https://34.71.197.190/api/shifts`
- **Health Check**: `https://34.71.197.190/health/detailed`
- **Job Acceptance**: `https://34.71.197.190/api/accept-job/{jobId}`

### Without HTTPS (Direct)
- **API Endpoint**: `http://34.71.197.190:3000/api/shifts`
- **Health Check**: `http://34.71.197.190:3000/health/detailed`
- **Job Acceptance**: `http://34.71.197.190:3000/api/accept-job/{jobId}`

## Management Commands

### Check Service Status
```bash
# Check if service is running
ps aux | grep aesop-checker

# View logs
tail -f aesop-checker.log

# Test connectivity
curl http://localhost:3000/health/detailed
```

### Service Control
```bash
# Start service
./quick-start.sh

# Stop service
./stop-service.sh

# Restart service
./restart-service.sh
```

## Troubleshooting

### Service Won't Start
1. Check logs: `tail -f aesop-checker.log`
2. Verify `.env` file has correct credentials
3. Ensure port 3000 is not in use: `lsof -i :3000`

### Can't Connect from React Native App
1. Verify service is running: `curl http://localhost:3000/health/detailed`
2. Check firewall rules: `sudo ufw status` or `gcloud compute firewall-rules list`
3. Test external connectivity: `curl http://34.71.197.190:3000/health/detailed`

### Permission Issues
```bash
# Fix permissions
chmod +x *.sh
sudo chown -R $USER:$USER .
```

## Production Setup (Optional)

For production use, run the full setup script:
```bash
./start-aesop-service.sh
```

This creates a systemd service that:
- Auto-starts on boot
- Restarts automatically if it crashes
- Runs with proper system logging
- Has better security and performance

## HTTPS Setup (Recommended)

If you want to use HTTPS port 443, run the HTTPS setup script:

```bash
# SSH into your VM
gcloud compute ssh your-instance-name

# Navigate to directory
cd aesop-checker

# Run HTTPS setup
./setup-https.sh
```

This script will:
- Install Nginx reverse proxy
- Set up SSL certificate with Let's Encrypt
- Configure HTTPS with automatic HTTP to HTTPS redirect
- Set up SSL auto-renewal
- Open necessary firewall ports

### HTTPS URLs
- **API Endpoint**: `https://34.71.197.190/api/shifts`
- **Health Check**: `https://34.71.197.190/health/detailed`

## React Native App Configuration

Your React Native app is already configured to connect to:
`https://34.71.197.190/api/shifts`

Once the service is running on your VM (with HTTPS setup), the app should work without any login prompts.

## Security Notes

1. **Environment File**: Keep your `.env` file secure and don't commit it to version control
2. **Firewall**: The script opens port 3000 to the world - consider restricting to specific IP ranges
3. **HTTPS**: For production, consider setting up HTTPS with SSL certificates
4. **Authentication**: The API endpoints are open - consider adding API key authentication for mobile apps

## Support

If you encounter issues:
1. Check the service logs: `tail -f aesop-checker.log`
2. Verify all prerequisites are installed
3. Test connectivity step by step
4. Check Google Cloud firewall rules in the console
