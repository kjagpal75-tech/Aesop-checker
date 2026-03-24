#!/bin/bash

# Aesop Checker Health Check Script
# Monitors the application health and reports status

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="aesop-checker.js"
APP_DIR="/home/kuljitjagpal/aesop-checker"
LOG_FILE="$APP_DIR/app.log"
PID_FILE="$APP_DIR/app.pid"
DASHBOARD_URL="http://localhost:3000"
MAX_LOG_SIZE_MB=50
MAX_MEMORY_MB=800
MAX_CHROME_PROCESSES=20

# Health check results
OVERALL_STATUS="HEALTHY"
ISSUES_FOUND=0

echo -e "${BLUE}🏥 Aesop Checker Health Check${NC}"
echo -e "${BLUE}=============================${NC}"
echo ""

# Function to print status
print_status() {
    local status=$1
    local message=$2
    case $status in
        "OK")
            echo -e "${GREEN}✅ $message${NC}"
            ;;
        "WARN")
            echo -e "${YELLOW}⚠️  $message${NC}"
            OVERALL_STATUS="WARNING"
            ISSUES_FOUND=$((ISSUES_FOUND + 1))
            ;;
        "ERROR")
            echo -e "${RED}❌ $message${NC}"
            OVERALL_STATUS="ERROR"
            ISSUES_FOUND=$((ISSUES_FOUND + 1))
            ;;
        "INFO")
            echo -e "${BLUE}ℹ️  $message${NC}"
            ;;
    esac
}

# 1. Check if app process is running
echo -e "${BLUE}1. Process Status${NC}"
if pgrep -f "$APP_NAME" > /dev/null; then
    APP_PID=$(pgrep -f "$APP_NAME" | head -1)
    print_status "OK" "App is running (PID: $APP_PID)"
    
    # Check process age
    PROCESS_AGE=$(ps -o etimes= -p $APP_PID | tr -d ' ')
    if [ -n "$PROCESS_AGE" ] && [ "$PROCESS_AGE" -gt 60 ]; then
        AGE_MINUTES=$((PROCESS_AGE / 60))
        print_status "OK" "Process uptime: $AGE_MINUTES minutes"
    else
        print_status "WARN" "Process started recently (${PROCESS_AGE}s ago)"
    fi
else
    print_status "ERROR" "App is NOT running"
fi
echo ""

# 2. Check dashboard accessibility
echo -e "${BLUE}2. Dashboard Status${NC}"
if curl -s --max-time 5 "$DASHBOARD_URL" > /dev/null; then
    HTTP_STATUS=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$DASHBOARD_URL")
    if [ "$HTTP_STATUS" = "200" ]; then
        print_status "OK" "Dashboard accessible (HTTP $HTTP_STATUS)"
    else
        print_status "WARN" "Dashboard responding but with HTTP $HTTP_STATUS"
    fi
else
    print_status "ERROR" "Dashboard is NOT accessible"
fi
echo ""

# 3. Check log file
echo -e "${BLUE}3. Log File Status${NC}"
if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(du -m "$LOG_FILE" | cut -f1)
    if [ "$LOG_SIZE" -gt "$MAX_LOG_SIZE_MB" ]; then
        print_status "WARN" "Log file is large (${LOG_SIZE}MB > ${MAX_LOG_SIZE_MB}MB)"
    else
        print_status "OK" "Log file size is normal (${LOG_SIZE}MB)"
    fi
    
    # Check recent log entries for errors
    if [ -s "$LOG_FILE" ]; then
        RECENT_ERRORS=$(tail -100 "$LOG_FILE" 2>/dev/null | grep -i -c "error\|failed\|crashed\|exception" || echo "0")
        if [ "$RECENT_ERRORS" -gt 5 ]; then
            print_status "WARN" "High error count in recent logs: $RECENT_ERRORS errors"
        elif [ "$RECENT_ERRORS" -gt 0 ]; then
            print_status "OK" "Some errors in recent logs: $RECENT_ERRORS errors"
        else
            print_status "OK" "No errors in recent logs"
        fi
    else
        print_status "WARN" "Log file is empty"
    fi
else
    print_status "ERROR" "Log file not found"
fi
echo ""

# 4. Check memory usage
echo -e "${BLUE}4. Memory Usage${NC}"
if pgrep -f "$APP_NAME" > /dev/null; then
    APP_PID=$(pgrep -f "$APP_NAME" | head -1)
    APP_MEMORY=$(ps -o rss= -p $APP_PID | tr -d ' ')
    if [ -n "$APP_MEMORY" ] && [ "$APP_MEMORY" -gt 0 ]; then
        APP_MEMORY_MB=$((APP_MEMORY / 1024))
        
        if [ "$APP_MEMORY_MB" -gt "$MAX_MEMORY_MB" ]; then
            print_status "ERROR" "High memory usage: ${APP_MEMORY_MB}MB > ${MAX_MEMORY_MB}MB"
        elif [ "$APP_MEMORY_MB" -gt 400 ]; then
            print_status "WARN" "Moderate memory usage: ${APP_MEMORY_MB}MB"
        else
            print_status "OK" "Memory usage is normal: ${APP_MEMORY_MB}MB"
        fi
    else
        print_status "WARN" "Could not determine app memory usage"
    fi
    
    # Check Chrome processes memory
    CHROME_MEMORY=$(ps aux | grep chrome | awk '{sum+=$6} END {print sum/1024}' | cut -d. -f1)
    if [ -n "$CHROME_MEMORY" ] && [ "$CHROME_MEMORY" -gt 0 ] && [ "$CHROME_MEMORY" -gt 600 ]; then
        print_status "WARN" "High Chrome memory usage: ${CHROME_MEMORY}MB"
    elif [ -n "$CHROME_MEMORY" ] && [ "$CHROME_MEMORY" -gt 0 ]; then
        print_status "OK" "Chrome memory usage: ${CHROME_MEMORY}MB"
    else
        print_status "WARN" "Could not determine Chrome memory usage"
    fi
fi
echo ""

# 5. Check Chrome processes
echo -e "${BLUE}5. Chrome Processes${NC}"
CHROME_COUNT=$(pgrep -f chrome | wc -l)
if [ "$CHROME_COUNT" -gt "$MAX_CHROME_PROCESSES" ]; then
    print_status "WARN" "Many Chrome processes: $CHROME_COUNT"
else
    print_status "OK" "Chrome processes: $CHROME_COUNT"
fi

# Check for orphaned Chrome processes
if pgrep -f "$APP_NAME" > /dev/null; then
    APP_PID=$(pgrep -f "$APP_NAME" | head -1)
    # Check if Chrome processes are children of the app
    CHROME_CHILDREN=$(pstree -p $APP_PID | grep -c chrome || echo "0")
    TOTAL_CHROME=$(pgrep -f chrome | wc -l)
    ORPHANED_CHROME=$((TOTAL_CHROME - CHROME_CHILDREN))
    
    if [ "$ORPHANED_CHROME" -gt 0 ]; then
        print_status "WARN" "Found $ORPHANED_CHROME potentially orphaned Chrome processes"
    else
        print_status "OK" "No orphaned Chrome processes detected"
    fi
fi
echo ""

# 6. Check recent activity
echo -e "${BLUE}6. Recent Activity${NC}"
if [ -f "$LOG_FILE" ]; then
    # Check last log entry timestamp
    LAST_LOG=$(tail -1 "$LOG_FILE" 2>/dev/null | grep -o '\[.*\]' | head -1 || echo "")
    if [ -n "$LAST_LOG" ]; then
        print_status "OK" "Last log entry: $LAST_LOG"
    else
        print_status "WARN" "No recent log entries found"
    fi
    
    # Check if job checking is active
    RECENT_CHECKS=$(tail -50 "$LOG_FILE" 2>/dev/null | grep -c "Checking for shifts" || echo "0")
    if [ "$RECENT_CHECKS" -gt 0 ]; then
        print_status "OK" "Job checking is active ($RECENT_CHECKS checks in recent logs)"
    else
        print_status "WARN" "No recent job checking activity"
    fi
fi
echo ""

# 7. System resources
echo -e "${BLUE}7. System Resources${NC}"
# Memory
TOTAL_MEM=$(free -m | awk 'NR==2{print $2}')
USED_MEM=$(free -m | awk 'NR==2{print $3}')
FREE_MEM=$(free -m | awk 'NR==2{print $4}')
MEM_PERCENT=$((USED_MEM * 100 / TOTAL_MEM))

if [ "$MEM_PERCENT" -gt 90 ]; then
    print_status "ERROR" "High system memory usage: ${MEM_PERCENT}% (${USED_MEM}MB/${TOTAL_MEM}MB)"
elif [ "$MEM_PERCENT" -gt 80 ]; then
    print_status "WARN" "Moderate system memory usage: ${MEM_PERCENT}% (${USED_MEM}MB/${TOTAL_MEM}MB)"
else
    print_status "OK" "System memory usage: ${MEM_PERCENT}% (${USED_MEM}MB/${TOTAL_MEM}MB)"
fi

# Disk space
DISK_USAGE=$(df "$APP_DIR" | awk 'NR==2{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 90 ]; then
    print_status "ERROR" "High disk usage: ${DISK_USAGE}%"
elif [ "$DISK_USAGE" -gt 80 ]; then
    print_status "WARN" "Moderate disk usage: ${DISK_USAGE}%"
else
    print_status "OK" "Disk usage: ${DISK_USAGE}%"
fi
echo ""

# 8. Overall status
echo -e "${BLUE}8. Overall Health${NC}"
case $OVERALL_STATUS in
    "HEALTHY")
        echo -e "${GREEN}🎉 Overall Status: HEALTHY${NC}"
        echo -e "${GREEN}   All systems operational${NC}"
        ;;
    "WARNING")
        echo -e "${YELLOW}⚠️  Overall Status: WARNING${NC}"
        echo -e "${YELLOW}   $ISSUES_FOUND issues found - monitor closely${NC}"
        ;;
    "ERROR")
        echo -e "${RED}🚨 Overall Status: ERROR${NC}"
        echo -e "${RED}   $ISSUES_FOUND critical issues - immediate attention required${NC}"
        ;;
esac

echo ""
echo -e "${BLUE}Health check completed at: $(date)${NC}"

# Exit with appropriate code
case $OVERALL_STATUS in
    "HEALTHY") exit 0 ;;
    "WARNING") exit 1 ;;
    "ERROR") exit 2 ;;
esac
