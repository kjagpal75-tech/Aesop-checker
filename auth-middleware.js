// Authentication Middleware for Aesop Dashboard
// Provides secure login protection for the dashboard

const crypto = require('crypto');

// Simple in-memory session storage (for production, consider Redis or database)
const sessions = new Map();
const failedAttempts = new Map();

// Configuration
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// Generate secure random token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Hash password with salt
function hashPassword(password, salt = null) {
    const actualSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, actualSalt, 10000, 64, 'sha512').toString('hex');
    return { hash, salt: actualSalt };
}

// Verify password
function verifyPassword(password, hash, salt) {
    const hashVerify = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return hash === hashVerify;
}

// Clean up expired sessions
function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
        if (now - session.created > SESSION_DURATION) {
            sessions.delete(token);
        }
    }
    
    // Clean up expired lockouts
    for (const [ip, lockout] of failedAttempts.entries()) {
        if (now - lockout.until > 0) {
            failedAttempts.delete(ip);
        }
    }
}

// Get client IP
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress || 
           req.ip || 'unknown';
}

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
    cleanupExpiredSessions();
    
    const token = req.cookies?.aesop_session;
    const session = sessions.get(token);
    
    if (session && (Date.now() - session.created) < SESSION_DURATION) {
        // Refresh session
        session.created = Date.now();
        req.user = session.user;
        next();
    } else {
        // Clear invalid session
        if (token) {
            sessions.delete(token);
            res.clearCookie('aesop_session');
        }
        
        // For API requests, return 401
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        // For web requests, redirect to login
        res.redirect('/login');
    }
}

// Login route handler
function handleLogin(req, res) {
    const ip = getClientIP(req);
    const { username, password } = req.body;
    
    // Check if IP is locked out
    const lockout = failedAttempts.get(ip);
    if (lockout && Date.now() < lockout.until) {
        const remaining = Math.ceil((lockout.until - Date.now()) / 60000);
        return res.status(429).json({ 
            error: `Too many failed attempts. Try again in ${remaining} minutes.` 
        });
    }
    
    // Get credentials from config
    const CONFIG = require('./config');
    const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || CONFIG.dashboardUsername || 'admin';
    const DASHBOARD_PASSWORD_HASH = process.env.DASHBOARD_PASSWORD_HASH;
    const DASHBOARD_PASSWORD_SALT = process.env.DASHBOARD_PASSWORD_SALT;
    
    // Default credentials (should be overridden by environment variables)
    const defaultCredentials = hashPassword('Aesop@2026!');
    
    let isValid = false;
    
    if (username === DASHBOARD_USERNAME) {
        if (DASHBOARD_PASSWORD_HASH && DASHBOARD_PASSWORD_SALT) {
            // Use environment variables
            isValid = verifyPassword(password, DASHBOARD_PASSWORD_HASH, DASHBOARD_PASSWORD_SALT);
        } else {
            // Use default credentials
            isValid = verifyPassword(password, defaultCredentials.hash, defaultCredentials.salt);
        }
    }
    
    if (isValid) {
        // Clear failed attempts
        failedAttempts.delete(ip);
        
        // Create session
        const token = generateToken();
        sessions.set(token, {
            user: username,
            created: Date.now(),
            ip: ip
        });
        
        // Set secure cookie
        const cookieOptions = {
            httpOnly: true,
            secure: true, // Only send over HTTPS
            maxAge: SESSION_DURATION,
            sameSite: 'strict'
        };
        
        res.cookie('aesop_session', token, cookieOptions);
        res.json({ success: true, message: 'Login successful' });
        
    } else {
        // Record failed attempt
        if (!failedAttempts.has(ip)) {
            failedAttempts.set(ip, { count: 1, until: 0 });
        } else {
            const attempts = failedAttempts.get(ip);
            attempts.count++;
            
            // Lock out after max attempts
            if (attempts.count >= MAX_FAILED_ATTEMPTS) {
                attempts.until = Date.now() + LOCKOUT_DURATION;
            }
        }
        
        const remaining = MAX_FAILED_ATTEMPTS - (failedAttempts.get(ip)?.count || 0);
        res.status(401).json({ 
            error: 'Invalid credentials',
            remainingAttempts: remaining > 0 ? remaining : 0
        });
    }
}

// Logout route handler
function handleLogout(req, res) {
    const token = req.cookies?.aesop_session;
    if (token) {
        sessions.delete(token);
    }
    
    res.clearCookie('aesop_session');
    res.json({ success: true, message: 'Logged out successfully' });
}

// Check authentication status
function checkAuthStatus(req, res) {
    const token = req.cookies?.aesop_session;
    const session = sessions.get(token);
    
    if (session && (Date.now() - session.created) < SESSION_DURATION) {
        res.json({ 
            authenticated: true, 
            user: session.user,
            expires: new Date(session.created + SESSION_DURATION)
        });
    } else {
        res.json({ authenticated: false });
    }
}

// Middleware to parse cookies
function cookieParser(req, res, next) {
    const cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            cookies[name] = value;
        });
    }
    req.cookies = cookies;
    next();
}

module.exports = {
    requireAuth,
    handleLogin,
    handleLogout,
    checkAuthStatus,
    cookieParser,
    hashPassword,
    verifyPassword
};
