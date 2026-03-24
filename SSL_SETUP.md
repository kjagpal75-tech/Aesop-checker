# SSL/HTTPS Setup for Aesop Dashboard

## Overview

The Aesop Shift Checker dashboard now supports SSL/HTTPS through an Nginx reverse proxy with SSL termination. This provides secure, encrypted access to the web interface.

## Architecture

```
Browser (HTTPS) → Nginx (SSL Termination) → Node.js App (HTTP)
```

- **Nginx**: Handles SSL/TLS encryption and acts as reverse proxy
- **Node.js App**: Runs on HTTP (port 3000) behind Nginx
- **SSL Certificate**: Self-signed certificate (can be upgraded to Let's Encrypt)

## Current Configuration

### URLs
- **HTTPS**: `https://34.71.197.190` (primary)
- **HTTP**: `http://34.71.197.190` (auto-redirects to HTTPS)
- **Direct App**: `http://34.71.197.190:3000` (still accessible)

### SSL Certificate
- **Type**: Self-signed
- **Validity**: 1 year
- **Algorithm**: RSA 2048-bit
- **Subject**: CN=aesop-server

### Security Features
- ✅ **Automatic HTTP to HTTPS redirect**
- ✅ **SSL/TLS hardening** (TLS 1.2+ only)
- ✅ **Security headers** (HSTS, XSS protection, frame options)
- ✅ **Reverse proxy** with proper headers
- ✅ **Firewall rules** for ports 80/443

## Setup Instructions

### 1. Deploy SSL Setup
```bash
./deploy-ssl.sh
```

This script:
- Installs Nginx (if not present)
- Generates self-signed SSL certificate
- Configures Nginx reverse proxy
- Updates firewall rules
- Updates app configuration
- Restarts services

### 2. Manual Setup (Alternative)

#### Install Nginx
```bash
sudo apt update
sudo apt install -y nginx
```

#### Generate SSL Certificate
```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/aesop.key \
    -out /etc/nginx/ssl/aesop.crt \
    -subj '/C=US/ST=California/L=Fremont/O=Fremont Unified/CN=aesop-server'
```

#### Configure Nginx
```bash
# Copy nginx-ssl.conf to /etc/nginx/sites-available/aesop-ssl
sudo ln -s /etc/nginx/sites-available/aesop-ssl /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

#### Update Firewall
```bash
gcloud compute firewall-rules update default-allow-http --allow tcp:80,tcp:3000
```

#### Update App Configuration
```bash
cd /home/kuljitjagpal/aesop-checker
sed -i 's|PUBLIC_URL=http://34.71.197.190:3000|PUBLIC_URL=https://34.71.197.190|' .env
# Restart app
```

## Testing SSL Setup

### Test HTTPS Access
```bash
# Test HTTPS (ignore self-signed cert warning)
curl -k -I https://34.71.197.190

# Expected: HTTP/2 200
```

### Test HTTP Redirect
```bash
# Test HTTP to HTTPS redirect
curl -I http://34.71.197.190

# Expected: HTTP/1.1 301 Moved Permanently
# Location: https://34.71.197.190/
```

### Test from Server
```bash
# Test locally
curl -k https://localhost
curl http://localhost
```

## Browser Access

### Self-Signed Certificate Warning
When accessing `https://34.71.197.190` in a browser, you'll see a security warning because the certificate is self-signed.

**Chrome/Edge:**
1. Click "Advanced"
2. Click "Proceed to 34.71.197.190 (unsafe)"

**Firefox:**
1. Click "Advanced"
2. Click "Accept the Risk and Continue"

**Safari:**
1. Click "Show Details"
2. Click "visit this website"

## Upgrading to Let's Encrypt (Recommended)

For production use, upgrade to a free Let's Encrypt certificate:

### Install Certbot
```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

### Generate Certificate
```bash
sudo certbot --nginx -d 34.71.197.190
```

### Auto-Renewal
```bash
# Test auto-renewal
sudo certbot renew --dry-run

# Auto-renewal is automatically configured
crontab -l | grep certbot
```

## Security Configuration

### SSL Settings
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
```

### Security Headers
```nginx
add_header X-Frame-Options DENY;
add_header X-Content-Type-Options nosniff;
add_header X-XSS-Protection "1; mode=block";
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

### Proxy Headers
```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

## Troubleshooting

### SSL Certificate Issues
```bash
# Check certificate validity
openssl x509 -in /etc/nginx/ssl/aesop.crt -text -noout

# Check certificate expiration
openssl x509 -in /etc/nginx/ssl/aesop.crt -noout -dates

# Test SSL configuration
sudo nginx -t
```

### Nginx Issues
```bash
# Check Nginx status
sudo systemctl status nginx

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Restart Nginx
sudo systemctl restart nginx
```

### Firewall Issues
```bash
# Check firewall rules
gcloud compute firewall-rules list --filter="name~default"

# Check open ports
sudo netstat -tlnp | grep -E ':80|:443'
```

### App Issues
```bash
# Check app logs
tail -f /home/kuljitjagpal/aesop-checker/app.log

# Check app configuration
grep PUBLIC_URL /home/kuljitjagpal/aesop-checker/.env

# Restart app
ps aux | grep 'node aesop-checker.js' | grep -v grep | awk '{print $2}' | xargs kill
cd /home/kuljitjagpal/aesop-checker && nohup node aesop-checker.js > app.log 2>&1 &
```

## Performance Considerations

### SSL Termination
- Nginx handles SSL encryption/decryption
- Node.js app serves HTTP only (better performance)
- Reduced CPU load on Node.js process

### Caching
- Nginx can cache static assets
- Consider adding cache headers for static content
- Monitor SSL session reuse

### Monitoring
- Monitor SSL certificate expiration
- Monitor Nginx error logs for SSL issues
- Monitor app performance behind proxy

## File Locations

### SSL Certificate
- **Private Key**: `/etc/nginx/ssl/aesop.key`
- **Certificate**: `/etc/nginx/ssl/aesop.crt`

### Nginx Configuration
- **Main Config**: `/etc/nginx/nginx.conf`
- **Site Config**: `/etc/nginx/sites-available/aesop-ssl`
- **Logs**: `/var/log/nginx/`

### App Configuration
- **Environment**: `/home/kuljitjagpal/aesop-checker/.env`
- **App Logs**: `/home/kuljitjagpal/aesop-checker/app.log`

## Best Practices

1. **Use Let's Encrypt** for production (free, trusted certificates)
2. **Monitor certificate expiration** (set up renewal alerts)
3. **Test SSL configuration** regularly
4. **Keep Nginx updated** for security patches
5. **Monitor performance** after SSL implementation
6. **Use HTTPS URLs** in all configurations
7. **Test redirect functionality** periodically
8. **Backup SSL certificates** and configuration files

## Migration Notes

### Before SSL
- Direct access to `http://34.71.197.190:3000`
- No encryption
- Plain text traffic

### After SSL
- Primary access via `https://34.71.197.190`
- Automatic HTTP to HTTPS redirect
- Encrypted traffic
- Security headers enabled
- Port 3000 still accessible (for fallback)

The SSL setup provides a secure, professional interface for the Aesop Shift Checker while maintaining backward compatibility.
