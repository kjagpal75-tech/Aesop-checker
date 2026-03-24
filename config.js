require('dotenv').config();

module.exports = {
    aesopUrl: process.env.AESOP_URL || 'https://login.frontlineeducation.com/login?signin=f031bc8d11b97a292b84a51dad08ca09&productId=ABSMGMT&clientId=ABSMGMT#/login',
    
    // Aesop Login Credentials
    username: process.env.AESOP_USERNAME,
    password: process.env.AESOP_PASSWORD,
    
    // Email Configuration
    emailTo: process.env.EMAIL_TO,
    emailFrom: process.env.EMAIL_FROM,
    emailPassword: process.env.EMAIL_PASSWORD, // Fallback for App Password method
    
    // Job Notification Configuration (additional recipients for new jobs only)
    jobNotificationTo: process.env.JOB_NOTIFICATION_TO, // Additional recipients for job notifications only
    
    // Debug/Error Email Configuration
    debugEmailTo: process.env.DEBUG_EMAIL_TO || process.env.EMAIL_FROM, // Default to EMAIL_FROM for debug/error messages
    
    // OAuth2 Configuration for Outlook
    oauthClientId: process.env.OAUTH_CLIENT_ID,
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET,
    oauthRefreshToken: process.env.OAUTH_REFRESH_TOKEN,
    oauthAccessToken: process.env.OAUTH_ACCESS_TOKEN,
    
    // Search Settings
    checkInterval: parseInt(process.env.CHECK_INTERVAL) || 60 * 1000, // 1 minute default (configurable via CHECK_INTERVAL env var)
    realTimeMode: process.env.REAL_TIME_MODE === 'true', // Instant notifications (keeps browser open)
    realTimeInterval: parseInt(process.env.REAL_TIME_INTERVAL) || 30 * 1000, // 30 seconds for real-time checks
    publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000', // Public URL for email links and API calls
    
    // Auto-Accept Settings
    autoAcceptEnabled: process.env.AUTO_ACCEPT_ENABLED === 'true', // Enable/disable auto-accept
    autoAcceptHoursInFuture: parseInt(process.env.AUTO_ACCEPT_HOURS_IN_FUTURE) || 48, // Auto-accept jobs X+ hours in future
    autoAcceptLogOnly: process.env.AUTO_ACCEPT_LOG_ONLY === 'true', // Log only mode (don't actually accept)
    
    // Auto-Accept School Filter - Only accept jobs from these schools
    autoAcceptSchools: process.env.AUTO_ACCEPT_SCHOOLS ? 
        process.env.AUTO_ACCEPT_SCHOOLS.split(',').map(s => s.trim().toUpperCase()) : [
            'WASHINGTON HIGH SCHOOL',
            'AMERICAN HIGH SCHOOL', 
            'HORNER MIDDLE SCHOOL',
            'HOPKINS MIDDLE SCHOOL',
            'KENNEDY HIGH SCHOOL',
            'MISSION SAN JOSE HIGH SCHOOL',
            'IRVINGTON HIGH SCHOOL'
        ],
    
    position: process.env.POSITION || 'Substitute Teacher',
    district: process.env.DISTRICT || 'Fremont Unified School District',
    
    // Dashboard Authentication
    dashboardUsername: process.env.DASHBOARD_USERNAME || 'admin',
    // Default password: Aesop@2026! (should be overridden by environment variables)
};
