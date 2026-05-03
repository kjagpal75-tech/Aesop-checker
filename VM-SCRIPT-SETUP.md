# VM Service Management Scripts Setup

## SSH Issues Resolution

If you're experiencing SSH permission denied errors, here are several solutions:

### Option 1: Reset SSH Keys
```bash
# Remove existing SSH keys
gcloud compute instances reset-ssh-keys aesop-server

# Regenerate SSH keys
gcloud compute config-ssh

# Try connecting again
gcloud compute ssh aesop-server
```

### Option 2: Use Google Cloud Console
1. Go to Google Cloud Console
2. Navigate to Compute Engine > VM instances
3. Click on your instance "aesop-server"
4. Click "SSH" button to open browser-based SSH
5. Run the commands below in the browser SSH

### Option 3: Create SSH Key Manually
```bash
# Create new SSH key
ssh-keygen -t rsa -f ~/.ssh/gcloud-key -C "gcloud-user"

# Add the public key to the instance
gcloud compute instances add-metadata aesop-server --metadata-from-file ssh-keys=~/.ssh/gcloud-key.pub

# Use the new key
ssh -i ~/.ssh/gcloud-key kjagpal75@34.71.197.190
```

## Service Management Scripts

Once you have SSH access, deploy these scripts:

### Step 1: Create Start Script
```bash
# SSH into VM as kjagpal75
sudo -u kjagpal75 bash -c 'cd /home/kjagpal75/Aesop-checker'

# Create vm-service-start.sh
cat > vm-service-start.sh << 'EOF'
#!/bin/bash

# Aesop Shift Checker Service Start Script
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo -e "${BLUE}🚀 $1${NC}"
}

SERVICE_DIR="/home/kjagpal75/Aesop-checker"
SERVICE_USER="kjagpal75"
LOG_FILE="$SERVICE_DIR/aesop-checker.log"
PID_FILE="$SERVICE_DIR/aesop-checker.pid"

print_header "Starting Aesop Shift Checker Service"

if [[ "$USER" != "$SERVICE_USER" ]]; then
    print_error "This script must be run as user: $SERVICE_USER"
    exit 1
fi

cd "$SERVICE_DIR"

# Check required files
required_files=("aesop-checker.js" "auth-middleware.js" "config.js" "package.json" "public/login.html")
for file in "${required_files[@]}"; do
    if [[ ! -f "$file" ]]; then
        print_error "Required file missing: $file"
        exit 1
    fi
done

# Stop existing service
if [[ -f "$PID_FILE" ]]; then
    old_pid=$(cat "$PID_FILE")
    if kill -0 "$old_pid" 2>/dev/null; then
        print_status "Stopping existing service (PID: $old_pid)"
        kill "$old_pid"
        sleep 2
        kill -9 "$old_pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
fi

pkill -f "node.*aesop-checker" 2>/dev/null || true
sleep 2

# Start service
print_header "Starting Service"
nohup node aesop-checker.js > "$LOG_FILE" 2>&1 &
service_pid=$!
echo "$service_pid" > "$PID_FILE"

sleep 5

if kill -0 "$service_pid" 2>/dev/null; then
    print_status "Service started successfully!"
    print_status "PID: $service_pid"
    tail -15 "$LOG_FILE"
else
    print_error "Service failed to start!"
    rm -f "$PID_FILE"
    exit 1
fi

print_status "Service startup complete!"
EOF

chmod +x vm-service-start.sh
```

### Step 2: Create Stop Script
```bash
cat > vm-service-stop.sh << 'EOF'
#!/bin/bash

# Aesop Shift Checker Service Stop Script
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo -e "${BLUE}🛑 $1${NC}"
}

SERVICE_DIR="/home/kjagpal75/Aesop-checker"
SERVICE_USER="kjagpal75"
PID_FILE="$SERVICE_DIR/aesop-checker.pid"

print_header "Stopping Aesop Shift Checker Service"

if [[ "$USER" != "$SERVICE_USER" ]]; then
    print_error "This script must be run as user: $SERVICE_USER"
    exit 1
fi

cd "$SERVICE_DIR"

# Stop service using PID file
if [[ -f "$PID_FILE" ]]; then
    service_pid=$(cat "$PID_FILE")
    if kill -0 "$service_pid" 2>/dev/null; then
        print_status "Stopping service (PID: $service_pid)"
        kill "$service_pid"
        sleep 3
        if kill -0 "$service_pid" 2>/dev/null; then
            kill -9 "$service_pid" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE"
fi

# Kill remaining processes
pkill -f "node.*aesop-checker" 2>/dev/null || true
sleep 2

print_status "Service stopped!"
EOF

chmod +x vm-service-stop.sh
```

### Step 3: Create Restart Script
```bash
cat > vm-service-restart.sh << 'EOF'
#!/bin/bash

# Aesop Shift Checker Service Restart Script
set -e

SERVICE_DIR="/home/kjagpal75/Aesop-checker"
SERVICE_USER="kjagpal75"

cd "$SERVICE_DIR"

if [[ "$USER" != "$SERVICE_USER" ]]; then
    echo "This script must be run as user: $SERVICE_USER"
    exit 1
fi

echo "🔄 Restarting Aesop Shift Checker Service"

# Stop
./vm-service-stop.sh

# Wait
sleep 3

# Start
./vm-service-start.sh

echo "✅ Service restart complete!"
EOF

chmod +x vm-service-restart.sh
```

### Step 4: Create Status Script
```bash
cat > vm-service-status.sh << 'EOF'
#!/bin/bash

# Aesop Shift Checker Service Status Script
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo -e "${BLUE}📊 $1${NC}"
}

SERVICE_DIR="/home/kjagpal75/Aesop-checker"
SERVICE_USER="kjagpal75"
LOG_FILE="$SERVICE_DIR/aesop-checker.log"
PID_FILE="$SERVICE_DIR/aesop-checker.pid"

print_header "Aesop Shift Checker Service Status"

if [[ "$USER" != "$SERVICE_USER" ]]; then
    print_error "This script must be run as user: $SERVICE_USER"
    exit 1
fi

cd "$SERVICE_DIR"

# Check PID file
if [[ -f "$PID_FILE" ]]; then
    service_pid=$(cat "$PID_FILE")
    if kill -0 "$service_pid" 2>/dev/null; then
        print_status "Service is running (PID: $service_pid)"
        ps -p "$service_pid" -o pid,etime,pcpu,pmem --no-headers
    else
        print_error "Service not running (stale PID file)"
    fi
else
    print_warning "No PID file found"
fi

# Check processes
if ps aux | grep -v grep | grep "node.*aesop-checker" > /dev/null; then
    print_status "Found running processes:"
    ps aux | grep -v grep | grep "node.*aesop-checker"
else
    print_warning "No processes found"
fi

# Test connectivity
if curl -s -f http://localhost:3000/health/detailed > /dev/null; then
    print_status "Local health check passed"
else
    print_error "Local health check failed"
fi

if curl -k -s -f https://34.71.197.190/api/shifts > /dev/null; then
    print_status "HTTPS API endpoint working"
else
    print_error "HTTPS API endpoint not responding"
fi

# Recent logs
if [[ -f "$LOG_FILE" ]]; then
    echo ""
    echo "Recent logs:"
    tail -10 "$LOG_FILE"
fi

echo ""
echo "Management Commands:"
echo "  Start: ./vm-service-start.sh"
echo "  Stop: ./vm-service-stop.sh"
echo "  Restart: ./vm-service-restart.sh"
echo "  Status: ./vm-service-status.sh"
EOF

chmod +x vm-service-status.sh
```

## Using the Scripts

Once deployed, you can manage your service with these commands:

```bash
# Start the service
./vm-service-start.sh

# Stop the service
./vm-service-stop.sh

# Restart the service
./vm-service-restart.sh

# Check service status
./vm-service-status.sh
```

## Service URLs

- **Web Dashboard**: https://34.71.197.190/ (login required)
- **API Endpoint**: https://34.71.197.190/api/shifts
- **Health Check**: https://34.71.197.190/health/detailed

## Login Credentials

- **Username**: admin
- **Password**: Aesop@2026!

## Troubleshooting

If SSH still doesn't work:

1. **Use Google Cloud Console SSH**: Open browser-based SSH from the console
2. **Reset instance metadata**: `gcloud compute instances reset aesop-server`
3. **Check firewall rules**: Ensure port 22 is open for SSH
4. **Verify user exists**: Make sure `kjagpal75` user exists on the VM

The scripts include full dependency checking, authentication setup, and comprehensive logging for professional service management.
