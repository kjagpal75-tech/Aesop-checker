# Dashboard Authentication System

## Overview

The Aesop Shift Checker dashboard now includes a secure authentication system that requires users to log in before accessing the dashboard and its features.

## Security Features

### 🔐 Authentication Methods
- **Username/Password Login**: Secure credential-based authentication
- **Session Management**: 24-hour session duration with automatic cleanup
- **Failed Attempt Lockout**: 5 failed attempts trigger 15-minute IP lockout
- **Secure Cookies**: HTTP-only, HTTPS-only, same-site strict cookies
- **Password Hashing**: PBKDF2 with 10,000 iterations and random salt

### 🛡️ Security Measures
- **HTTPS Only**: All authentication traffic encrypted
- **IP-based Lockout**: Prevents brute force attacks
- **Session Expiration**: Automatic logout after 24 hours
- **Password Strength**: Enforced strong password requirements
- **Failed Attempt Tracking**: Monitors and blocks suspicious activity

## Access Control

### Public Endpoints (No Authentication Required)
- `/login` - Login page
- `/health` - Basic health check
- `/api/login` - Login API endpoint
- `/api/logout` - Logout API endpoint
- `/api/auth-status` - Authentication status check

### Protected Endpoints (Authentication Required)
- `/` - Main dashboard
- `/api/shifts` - Job listings API
- `/api/check-now` - Manual job check
- `/api/accept-job/:jobId` - Job acceptance
- `/health/detailed` - Detailed health information

## Default Credentials

### Initial Login
- **Username**: `admin`
- **Password**: `Aesop@2026!`

⚠️ **Security Warning**: Change the default password immediately after deployment!

## Setup Instructions

### 1. Deploy Authentication System
```bash
./deploy-auth.sh
```

This script:
- Deploys authentication middleware
- Creates secure password hash
- Updates configuration files
- Restarts the application
- Tests the authentication system

### 2. Manual Setup (Alternative)

#### Install Authentication Middleware
```bash
# Copy files to server
gcloud compute scp auth-middleware.js aesop-server:/home/kuljitjagpal/aesop-checker/
gcloud compute scp aesop-checker.js aesop-server:/home/kuljitjagpal/aesop-checker/
gcloud compute scp public/login.html aesop-server:/home/kuljitjagpal/aesop-checker/public/
```

#### Generate Secure Password Hash
```bash
# On the server
cd /home/kuljitjagpal/aesop-checker
node -e "
const { hashPassword } = require('./auth-middleware');
const result = hashPassword('YourSecurePassword123!');
console.log('HASH=' + result.hash);
console.log('SALT=' + result.salt);
"
```

#### Update Configuration
```bash
# Add to .env file
echo 'DASHBOARD_USERNAME=admin' >> .env
echo 'DASHBOARD_PASSWORD_HASH=your_hash_here' >> .env
echo 'DASHBOARD_PASSWORD_SALT=your_salt_here' >> .env
```

#### Restart Application
```bash
ps aux | grep 'node aesop-checker.js' | grep -v grep | awk '{print $2}' | xargs kill
cd /home/kuljitjagpal/aesop-checker
nohup node aesop-checker.js > app.log 2>&1 &
```

## Configuration

### Environment Variables
```bash
# Dashboard Authentication
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD_HASH=pbkdf2_hash_here
DASHBOARD_PASSWORD_SALT=random_salt_here
```

### Password Requirements
- Minimum 8 characters
- Mixed case letters
- At least one number
- At least one special character
- No common dictionary words

### Session Settings
- **Duration**: 24 hours
- **Cookie**: HTTP-only, HTTPS-only, same-site strict
- **Cleanup**: Automatic expired session removal

## User Experience

### Login Process
1. User navigates to `https://34.71.197.190`
2. Redirected to login page
3. Enters username and password
4. Successful login redirects to dashboard
5. Session cookie stored for 24 hours

### Session Management
- **Login**: 24-hour session created
- **Logout**: Session immediately terminated
- **Expiration**: Automatic logout after 24 hours
- **Security**: Session tied to IP address

### Failed Attempts
- **1-4 attempts**: Warning shown, remaining attempts displayed
- **5th attempt**: Account locked for 15 minutes
- **Lockout**: IP-based, prevents brute force attacks
- **Recovery**: Automatic unlock after lockout period

## API Endpoints

### Authentication APIs

#### POST /api/login
```json
Request:
{
  "username": "admin",
  "password": "Aesop@2026!"
}

Response (Success):
{
  "success": true,
  "message": "Login successful"
}

Response (Error):
{
  "error": "Invalid credentials",
  "remainingAttempts": 3
}
```

#### POST /api/logout
```json
Response:
{
  "success": true,
  "message": "Logged out successfully"
}
```

#### GET /api/auth-status
```json
Response (Authenticated):
{
  "authenticated": true,
  "user": "admin",
  "expires": "2026-03-25T21:45:00.000Z"
}

Response (Not Authenticated):
{
  "authenticated": false
}
```

## Security Best Practices

### Password Management
- Change default password immediately
- Use strong, unique passwords
- Rotate passwords regularly
- Never share credentials
- Use password managers

### Session Security
- Logout when finished using dashboard
- Clear browser cookies if using shared device
- Monitor for suspicious activity
- Use HTTPS only (enforced)

### Monitoring
- Check application logs for failed attempts
- Monitor IP lockouts
- Review authentication patterns
- Set up alerts for suspicious activity

## Troubleshooting

### Login Issues

#### Can't Access Dashboard
```bash
# Check if app is running
ps aux | grep 'node aesop-checker.js'

# Check authentication logs
tail -50 /home/kuljitjagpal/aesop-checker/app.log

# Test login page
curl -k -I https://34.71.197.190/login
```

#### Invalid Credentials
```bash
# Verify credentials in .env
grep DASHBOARD_ /home/kuljitjagpal/aesop-checker/.env

# Test password hash
node -e "
const { verifyPassword } = require('./auth-middleware');
console.log(verifyPassword('password', 'hash', 'salt'));
"
```

#### Session Issues
```bash
# Clear browser cookies
# Check session storage
# Verify cookie settings
```

### Lockout Issues

#### Account Locked Out
- Wait 15 minutes for automatic unlock
- Check failed attempt logs
- Verify IP address not blocked

#### Reset Lockout
```bash
# Restart application to clear all sessions and lockouts
ps aux | grep 'node aesop-checker.js' | grep -v grep | awk '{print $2}' | xargs kill
cd /home/kuljitjagpal/aesop-checker
nohup node aesop-checker.js > app.log 2>&1 &
```

## Advanced Configuration

### Custom Authentication
```javascript
// Modify auth-middleware.js for custom logic
function customAuth(username, password) {
    // Add your custom authentication logic
    // LDAP integration, database lookup, etc.
}
```

### Session Duration
```javascript
// Change session duration in auth-middleware.js
const SESSION_DURATION = 12 * 60 * 60 * 1000; // 12 hours
```

### Lockout Settings
```javascript
// Modify lockout parameters
const MAX_FAILED_ATTEMPTS = 3; // Reduce attempts
const LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes
```

## Integration with External Systems

### LDAP/Active Directory
```javascript
// Example LDAP integration
const ldap = require('ldapjs');

function authenticateWithLDAP(username, password) {
    // LDAP authentication logic
}
```

### Database Authentication
```javascript
// Example database integration
const bcrypt = require('bcrypt');

function authenticateWithDB(username, password) {
    // Database lookup and bcrypt verification
}
```

## File Locations

### Authentication Files
- **Middleware**: `/home/kuljitjagpal/aesop-checker/auth-middleware.js`
- **Login Page**: `/home/kuljitjagpal/aesop-checker/public/login.html`
- **Configuration**: `/home/kuljitjagpal/aesop-checker/.env`

### Logs
- **Application Logs**: `/home/kuljitjagpal/aesop-checker/app.log`
- **Authentication Events**: Logged in app.log

## Compliance and Security

### Data Protection
- No password storage in plain text
- Secure hash algorithm (PBKDF2)
- Random salt generation
- HTTPS-only transmission

### Access Control
- Role-based access possible (extendable)
- Session timeout enforcement
- IP-based lockout protection
- Audit trail capability

### Security Headers
- HSTS (HTTP Strict Transport Security)
- Secure cookie settings
- XSS protection headers
- Frame protection

The authentication system provides enterprise-grade security for the Aesop Shift Checker dashboard while maintaining ease of use and accessibility.
