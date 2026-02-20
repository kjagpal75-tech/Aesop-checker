# Aesop Shift Checker - Documentation

## Overview

The Aesop Shift Checker is an automated monitoring system for FrontLine Aesop substitute teaching opportunities. It continuously checks for available substitute teacher positions in the Fremont Unified School District and provides real-time notifications with optional auto-accept functionality.

## Features

### Core Functionality
- **Automated Job Monitoring**: Checks for new substitute teaching positions every minute
- **Email Notifications**: Sends alerts for new job opportunities
- **Auto-Accept**: Automatically accepts jobs 48+ hours in the future
- **Web Dashboard**: Real-time monitoring interface
- **Session Management**: Efficient browser session reuse
- **Error Handling**: Comprehensive error monitoring and notifications

### Email Configuration
- **Primary Recipient** (kjagpal75@gmail.com): Receives all notifications (jobs, errors, debug)
- **Secondary Recipient** (hkjagpal@hotmail.com): Receives new job notifications only
- **Gmail SMTP**: Uses app password for secure email delivery

## Architecture

### Application Structure
```
aesop-checker/
├── aesop-checker.js          # Main application logic
├── config.js                 # Configuration management
├── .env                      # Environment variables
├── public/
│   └── index.html           # Web dashboard
├── package.json             # Node.js dependencies
└── DOCUMENTATION.md         # This file
```

### Key Components

#### 1. Main Application (`aesop-checker.js`)
- **Express Server**: Web API and dashboard hosting
- **Puppeteer Integration**: Browser automation for Aesop interaction
- **Session Management**: Browser session persistence and reuse
- **Email System**: Nodemailer integration for notifications
- **Auto-Accept Logic**: Job filtering and automatic acceptance

#### 2. Configuration (`config.js`)
- Environment variable loading
- Email configuration
- Auto-accept settings
- Search parameters

#### 3. Web Dashboard (`public/index.html`)
- Real-time job status display
- Manual job acceptance interface
- Health monitoring
- "Check Now" functionality

## Configuration

### Environment Variables (.env)

#### Required Variables
```bash
# Aesop Configuration
AESOP_URL=https://login.frontlineeducation.com/login?signin=...
AESOP_USERNAME=your_username
AESOP_PASSWORD=your_password

# Email Configuration
EMAIL_TO=kjagpal75@gmail.com
EMAIL_FROM=kjagpal75@gmail.com
EMAIL_PASSWORD=your_gmail_app_password

# Job Notifications (additional recipients)
JOB_NOTIFICATION_TO=hkjagpal@hotmail.com
```

#### Optional Variables
```bash
# Search Settings
CHECK_INTERVAL=60000                    # 1 minute in milliseconds
POSITION=Substitute Teacher
DISTRICT=Fremont Unified School District
PUBLIC_URL=http://34.71.197.190:3000

# Auto-Accept Settings
AUTO_ACCEPT_ENABLED=true                # Enable/disable auto-accept
AUTO_ACCEPT_HOURS_IN_FUTURE=48          # Auto-accept jobs X+ hours in future
AUTO_ACCEPT_LOG_ONLY=false              # Log only mode (don't actually accept)

# Debug/Error Email Configuration
DEBUG_EMAIL_TO=kjagpal75@gmail.com
```

### Gmail Setup
1. Enable 2-factor authentication on your Gmail account
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Use the App Password in `EMAIL_PASSWORD` variable

## Deployment

### Local Development
```bash
npm install
npm start
```

### Production Deployment (Google Cloud VM)
1. Copy files to VM:
```bash
gcloud compute scp aesop-checker.js config.js .env public/ vm-instance:~/aesop-checker/
```

2. Start service:
```bash
gcloud compute ssh vm-instance --command="cd ~/aesop-checker && nohup node aesop-checker.js > app.log 2>&1 &"
```

### Dependencies
- **Node.js 20+**: Runtime environment
- **puppeteer**: Browser automation
- **express**: Web server framework
- **nodemailer**: Email delivery
- **dotenv**: Environment variable management
- **firebase-admin**: Push notifications (optional)

## API Endpoints

### Core Endpoints
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status
- `GET /api/shifts` - Get current available shifts
- `POST /api/check-jobs` - Trigger manual job check (Android app)
- `GET /api/check-now` - Manual job check with wait
- `GET /api/accept-job/:jobId` - Manual job acceptance

### Response Formats

#### Health Check
```json
{
  "status": "OK",
  "timestamp": "2026-02-20T05:43:22.221Z",
  "uptime": 318.50822715,
  "memory": {...},
  "lastCheck": "2026-02-20T05:43:05.563Z",
  "isChecking": false
}
```

#### Shifts API
```json
{
  "shifts": [...],
  "lastChecked": "2026-02-20T05:43:05.563Z",
  "isChecking": false
}
```

## Auto-Accept Logic

### Criteria
- **Time Threshold**: Jobs 48+ hours in the future
- **Position**: Substitute Teacher positions only
- **Availability**: Jobs with no substitute assigned (SubstituteId: null)

### Process Flow
1. **Job Discovery**: Find new shifts during regular checking
2. **Filtering**: Apply auto-accept criteria to new shifts
3. **Session Validation**: Ensure browser session is active
4. **Sequential Processing**: Accept each qualifying job individually
5. **Error Handling**: Continue processing if individual jobs fail
6. **Session Restoration**: Return browser to original state

### Session Management
- **30-minute Session Timeout**: Reuse sessions for efficiency
- **Automatic Re-login**: Session recovery when needed
- **Browser Protection**: Prevent session termination during auto-accept
- **Error Recovery**: Graceful handling of session loss

## Email Notifications

### Job Notifications
- **Recipients**: Primary + Secondary recipients
- **Content**: Job details, accept buttons, links to Aesop
- **Formatting**: HTML email with responsive design
- **Accept Links**: Direct job acceptance via API

### Error Notifications
- **Recipients**: Primary recipient only
- **Content**: Error details, stack trace, VM information
- **Purpose**: Debugging and system monitoring

### Email Templates
- **Job Alert**: Professional design with job details
- **Error Alert**: Technical information for troubleshooting
- **Subject Lines**: Clear, informative formatting

## Monitoring & Maintenance

### Health Monitoring
- **Uptime Tracking**: Process uptime monitoring
- **Memory Usage**: Memory consumption tracking
- **Session Status**: Browser session health
- **Job Statistics**: Shift discovery and acceptance metrics

### Log Management
- **Application Logs**: Console output and file logging
- **Error Logs**: Comprehensive error tracking
- **Debug Information**: Detailed session and job data

### Performance Optimization
- **Session Reuse**: Minimize login overhead
- **Efficient Parsing**: Optimized HTML processing
- **Memory Management**: Browser resource cleanup
- **Rate Limiting**: Respect Aesop server limits

## Security Considerations

### Credential Management
- **Environment Variables**: Sensitive data in .env file
- **Git Ignore**: .env excluded from version control
- **App Passwords**: Gmail app passwords instead of regular passwords

### Browser Security
- **Sandbox Arguments**: Secure Puppeteer launch options
- **Session Isolation**: Separate browser contexts
- **Cookie Management**: Secure session handling

### API Security
- **Input Validation**: Job ID validation
- **Error Handling**: Prevent information leakage
- **Rate Limiting**: Prevent abuse of manual endpoints

## Troubleshooting

### Common Issues

#### 1. Login Failures
- **Symptoms**: Unable to authenticate with Aesop
- **Solutions**: Check credentials, verify Aesop URL, test manual login

#### 2. Email Issues
- **Symptoms**: No email notifications
- **Solutions**: Verify Gmail app password, check SMTP settings, test email configuration

#### 3. Browser Issues
- **Symptoms**: Puppeteer crashes, session timeouts
- **Solutions**: Check VM resources, restart service, verify browser arguments

#### 4. Auto-Accept Failures
- **Symptoms**: Jobs not auto-accepted
- **Solutions**: Check time thresholds, verify job criteria, review session management

### Debug Mode
Enable detailed logging by setting:
```bash
AUTO_ACCEPT_LOG_ONLY=true  # Test auto-accept without actually accepting
```

### Log Analysis
- **Session Logs**: Monitor login and session reuse
- **Job Logs**: Track job discovery and acceptance
- **Error Logs**: Identify system issues

## Version History

### Recent Updates
- **v1.0.0**: Initial deployment with basic job monitoring
- **v1.1.0**: Added auto-accept functionality
- **v1.2.0**: Enhanced session management
- **v1.3.0**: Dual email notification system
- **v1.4.0**: Dashboard improvements and bug fixes

### Key Features Added
- Auto-accept for 48+ hour jobs
- Session persistence and reuse
- Dual recipient email notifications
- Enhanced error handling
- Dashboard "Check Now" functionality
- Robust date parsing for auto-accept

## Support & Contact

### Technical Support
- **Primary Contact**: kjagpal75@gmail.com
- **Error Notifications**: Automatically sent to primary contact
- **System Status**: Available via health endpoints

### Development
- **Repository**: https://github.com/kjagpal75-tech/Aesop-checker
- **Deployment**: Google Cloud VM (aesop-server)
- **Environment**: Production (us-central1-c)

---

**Document Version**: 1.0  
**Last Updated**: February 19, 2026  
**Application Version**: Latest (commit 34aa093)
