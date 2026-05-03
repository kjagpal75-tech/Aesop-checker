#!/bin/bash

# Deploy service management scripts to VM

echo "🚀 Deploying VM Service Management Scripts"

# Create start script
cat > /tmp/vm-service-start.sh << 'EOF'
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

# Create stop script
cat > /tmp/vm-service-stop.sh << 'EOF'
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

# Create restart script
cat > /tmp/vm-service-restart.sh << 'EOF'
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

# Create status script
cat > /tmp/vm-service-status.sh << 'EOF'
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

echo "✅ Scripts created in /tmp/"
echo ""
echo "To deploy to VM, run these commands:"
echo ""
echo "gcloud compute scp /tmp/vm-service-*.sh aesop-server:~/"
echo "gcloud compute ssh aesop-server --command 'sudo mv ~/vm-service-*.sh /home/kjagpal75/Aesop-checker/ && sudo chown kjagpal75:kjagpal75 /home/kjagpal75/Aesop-checker/vm-service-*.sh && sudo chmod +x /home/kjagpal75/Aesop-checker/vm-service-*.sh'"
echo ""
echo "Then on VM:"
echo "sudo -u kjagpal75 bash -c 'cd /home/kjagpal75/Aesop-checker && ./vm-service-start.sh'"
