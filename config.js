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
    
    // OAuth2 Configuration for Outlook
    oauthClientId: process.env.OAUTH_CLIENT_ID,
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET,
    oauthRefreshToken: process.env.OAUTH_REFRESH_TOKEN,
    oauthAccessToken: process.env.OAUTH_ACCESS_TOKEN,
    
    // Search Settings
    checkInterval: parseInt(process.env.CHECK_INTERVAL) || 10 * 60 * 1000, // 10 minutes default
    position: process.env.POSITION || 'Substitute Teacher',
    district: process.env.DISTRICT || 'Fremont Unified School District'
};
