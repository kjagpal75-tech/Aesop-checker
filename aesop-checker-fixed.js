// aesop-checker.js
const puppeteer = require('puppeteer');
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const CONFIG = require('./config'); // Load config from separate file

// State
let availableShifts = [];
let lastChecked = null;
let notifiedShiftIds = new Set();
let browser = null;
let page = null;
let sessionCookies = null;
let lastLoginTime = null;
let isChecking = false;

// Real-time monitoring variables
let realTimeBrowser = null;
let realTimePage = null;
let realTimeInterval = null;
let lastKnownJobs = new Set();

// Job acceptance tracking
let jobAcceptanceStatus = new Map(); // Track acceptance attempts

// Email transporter setup - OAuth2 only for Outlook
let transporter;

// Gmail with App Password (still works)
if (CONFIG.emailFrom && CONFIG.emailFrom.includes('gmail')) {
    console.log('Using Gmail SMTP with App Password');
    transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: CONFIG.emailFrom,
            pass: CONFIG.emailPassword
        }
    });
}
// Outlook requires OAuth2 - no basic auth fallback
else if (CONFIG.oauthClientId && CONFIG.oauthClientSecret && CONFIG.oauthRefreshToken) {
    console.log('Using OAuth2 authentication for Outlook (required)');
    transporter = nodemailer.createTransport({
        host: 'smtp-mail.outlook.com',
        port: 587,
        secure: false,
        auth: {
            type: 'OAuth2',
            user: CONFIG.emailFrom,
            clientId: CONFIG.oauthClientId,
            clientSecret: CONFIG.oauthClientSecret,
            refreshToken: CONFIG.oauthRefreshToken
        }
    });
} else {
    console.warn('Outlook requires OAuth2 authentication - email notifications disabled');
    console.log('To enable email:');
    console.log('1. Use Gmail instead, or');
    console.log('2. Set up OAuth2 for Outlook (requires Azure AD app registration)');
    transporter = null;
}

// Express app for dashboard
const app = express();
app.use(express.static('public'));

app.get('/api/shifts', (req, res) => {
    res.json({
        shifts: availableShifts,
        lastChecked: lastChecked,
        isChecking: isChecking
    });
});

app.get('/api/check-now', async (req, res) => {
    if (isChecking) {
        return res.json({ message: 'Check already in progress' });
    }
    checkForShifts();
    res.json({ message: 'Check started' });
});

// Add job acceptance endpoint
app.get('/api/accept-job/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    console.log(`Received request to accept job: ${jobId}`);
    
    try {
        const result = await acceptJob(jobId);
        res.json(result);
    } catch (error) {
        console.error('Error accepting job:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add email magic link acceptance endpoint
app.get('/accept/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    console.log(`Received EMAIL MAGIC LINK request to accept job: ${jobId}`);
    
    try {
        // Initialize status tracking
        jobAcceptanceStatus.set(jobId, { 
            status: 'processing', 
            startTime: Date.now(),
            message: 'Initializing...'
        });
        
        // Show a loading page while processing
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Accepting Job...</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen flex items-center justify-center">
                <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
                    <div class="text-center">
                        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <h1 class="text-2xl font-bold text-gray-800 mb-2">Accepting Job...</h1>
                        <p class="text-gray-600 mb-4">Please wait while we accept this job for you.</p>
                        
                        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                            <p class="text-sm text-blue-800"> Job ID: ${jobId}</p>
                            <p class="text-sm text-blue-800"> Processing: <span id="timer">0</span>s</p>
                        </div>
                        
                        <div id="status" class="text-sm text-gray-600">Initializing...</div>
                        
                        <script>
                            let seconds = 0;
                            const timer = setInterval(() => {
                                seconds++;
                                document.getElementById('timer').textContent = seconds;
                                
                                // Check status every 2 seconds
                                fetch('/api/accept-job-status/${jobId}')
                                    .then(response => response.json())
                                    .then(data => {
                                        const statusEl = document.getElementById('status');
                                        if (data.success) {
                                            clearInterval(timer);
                                            window.location.href = '/accept-success/${jobId}';
                                        } else if (data.status === 'timeout') {
                                            clearInterval(timer);
                                            window.location.href = '/accept-error/${jobId}?message=' + encodeURIComponent('Acceptance timed out. Please try manually.');
                                        } else if (data.status === 'error') {
                                            clearInterval(timer);
                                            window.location.href = '/accept-error/${jobId}?message=' + encodeURIComponent(data.message);
                                        } else {
                                            statusEl.textContent = data.message || 'Processing...';
                                        }
                                    })
                                    .catch(error => {
                                        console.error('Status check error:', error);
                                    });
                            }, 2000);
                        </script>
                    </div>
                </div>
                                }
                            })
                            .catch(error => {
                                console.error('Status check error:', error);
                                if (attempts >= maxAttempts) {
                                    window.location.href = '/accept-error/${jobId}?message=' + encodeURIComponent('Unable to check status after multiple attempts');
                                } else {
                                    setTimeout(checkStatus, 2000);
                                }
                            });
                    }
                    
                    // Start status checking
                    setTimeout(checkStatus, 1000);
                </script>
            </body>
            </html>
        `);
        
        // Process the job acceptance in the background
        acceptJob(jobId)
            .then(result => {
                console.log(`Job ${jobId} acceptance result:`, result);
                jobAcceptanceStatus.set(jobId, { 
                    status: result.success ? 'success' : 'failed',
                    message: result.message,
                    completed: true
                });
            })
            .catch(error => {
                console.error('Background job acceptance failed:', error);
                jobAcceptanceStatus.set(jobId, { 
                    status: 'failed',
                    message: error.message,
                    completed: true
                });
            });
        
    } catch (error) {
        console.error('Error setting up magic link acceptance:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Error</title></head>
            <body>
                <h1>Error</h1>
                <p>Unable to process job acceptance: ${error.message}</p>
                <a href="${CONFIG.aesopUrl}">Click here to accept manually in Aesop</a>
            </body>
            </html>
        `);
    }
});

// Job acceptance status endpoint
app.get('/api/accept-job-status/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    const status = jobAcceptanceStatus.get(jobId);
    
    if (!status) {
        return res.json({ success: false, status: 'not_found', message: 'Job acceptance not found' });
    }
    
    if (status.completed) {
        return res.json({
            success: status.status === 'success',
            status: status.status,
            message: status.message
        });
    }
    
    // Still processing
    const elapsed = Date.now() - status.startTime;
    if (elapsed > 60000) { // 1 minute timeout
        jobAcceptanceStatus.set(jobId, { 
            ...status,
            status: 'failed',
            message: 'Acceptance timed out after 1 minute'
        });
        return res.json({ success: false, status: 'failed', message: 'Acceptance timed out' });
    }
    
    res.json({ success: false, status: 'processing', message: status.message });
});

// Accept success page
app.get('/accept-success/:jobId', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Job Accepted! 🎉</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gradient-to-br from-green-50 to-emerald-100 min-h-screen flex items-center justify-center">
            <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
                <div class="text-center">
                    <div class="text-6xl mb-4">🎉</div>
                    <h1 class="text-3xl font-bold text-green-600 mb-2">Job Accepted!</h1>
                    <p class="text-gray-600 mb-6">Your substitute position has been successfully accepted in Aesop.</p>
                    
                    <div class="space-y-3">
                        <a href="${CONFIG.aesopUrl}" 
                           target="_blank"
                           class="block w-full bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700 transition">
                            🔍 View in Aesop
                        </a>
                        <a href="${CONFIG.publicUrl}" 
                           class="block w-full bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition">
                            📊 Back to Dashboard
                        </a>
                    </div>
                    
                    <p class="text-xs text-gray-500 mt-6">
                        You should receive a confirmation from Aesop shortly.
                    </p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Accept error page
app.get('/accept-error/:jobId', (req, res) => {
    const message = req.query.message || 'Unknown error occurred';
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Acceptance Error</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gradient-to-br from-red-50 to-orange-100 min-h-screen flex items-center justify-center">
            <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
                <div class="text-center">
                    <div class="text-6xl mb-4">❌</div>
                    <h1 class="text-3xl font-bold text-red-600 mb-2">Acceptance Failed</h1>
                    <p class="text-gray-600 mb-6">We couldn't automatically accept the job.</p>
                    
                    <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                        <p class="text-sm text-red-800">${message}</p>
                    </div>
                    
                    <div class="space-y-3">
                        <a href="${CONFIG.aesopUrl}" 
                           target="_blank"
                           class="block w-full bg-red-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-700 transition">
                            🔍 Accept Manually in Aesop
                        </a>
                        <a href="${CONFIG.publicUrl}" 
                           class="block w-full bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-700 transition">
                            📊 Back to Dashboard
                        </a>
                    </div>
                    
                    <p class="text-xs text-gray-500 mt-6">
                        You can still accept the job manually by logging into Aesop.
                    </p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Function to accept a job
async function acceptJob(jobId) {
    console.log(`Attempting to accept job ${jobId}...`);
    
    let browser;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount < maxRetries) {
        try {
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });
            
            // Set error handling for frame detachment
            page.on('error', (error) => {
                console.log('Page error detected:', error.message);
            });
            
            page.on('pageerror', (error) => {
                console.log('Page error detected:', error.message);
            });

            // Login to Aesop
            console.log('Logging in to accept job...');
            await page.goto(CONFIG.aesopUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000 
            });

        await page.waitForSelector('#Username', { timeout: 10000 });
        await page.waitForSelector('#Password', { timeout: 10000 });

        await page.click('#Username', { clickCount: 3 });
        await page.type('#Username', CONFIG.username, { delay: 50 });
        
        await page.click('#Password', { clickCount: 3 });
        await page.type('#Password', CONFIG.password, { delay: 50 });

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            page.click('#qa-button-login')
        ]);

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Navigate to Available Jobs page
        console.log('Navigating to Available Jobs to accept job...');
        await page.goto('https://absencesub.frontlineeducation.com/Substitute/Schedule/AvailableJobs', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Find and click the accept button for the specific job
        const acceptSuccess = await page.evaluate((targetJobId) => {
            const jobRows = document.querySelectorAll('tbody.job');
            
            for (let row of jobRows) {
                const jobIdElement = row.getAttribute('id');
                if (jobIdElement === targetJobId || row.textContent.includes(targetJobId)) {
                    const acceptButton = row.querySelector('.acceptButton');
                    if (acceptButton) {
                        console.log(`Found accept button for job ${targetJobId}`);
                        acceptButton.click();
                        return true;
                    }
                }
            }
            return false;
        }, jobId);

        if (acceptSuccess) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Look for confirmation dialog or success message
            const confirmation = await page.evaluate(() => {
                const successElements = document.querySelectorAll('[class*="success"], [class*="confirm"], [class*="accepted"]');
                return successElements.length > 0;
            });

            await browser.close();
            
            return {
                success: true,
                message: `Successfully accepted job ${jobId}`,
                confirmed: confirmation
            };
        } else {
            await browser.close();
            return {
                success: false,
                message: `Could not find accept button for job ${jobId}. Job may no longer be available.`
            };
        }

    } catch (error) {
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.log('Error closing browser during retry:', closeError.message);
            }
        }
        
        // Check for frame detachment error and retry
        if (error.message.includes('Navigating frame was detached') || 
            error.message.includes('Target closed') ||
            error.message.includes('Session closed') ||
            error.message.includes('Protocol error')) {
            
            retryCount++;
            console.log(`🔄 Frame detached error (attempt ${retryCount}/${maxRetries}), retrying...`);
            
            if (retryCount < maxRetries) {
                // Wait a bit before retrying
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue; // Retry the while loop
            } else {
                return {
                    success: false,
                    message: `Failed to accept job ${jobId} after ${maxRetries} attempts due to browser instability: ${error.message}`
                };
            }
        }
        
        // For other errors, don't retry
        return {
            success: false,
            message: `Failed to accept job ${jobId}: ${error.message}`
        };
    }
    
    // This should never be reached, but just in case
    return {
        success: false,
        message: `Failed to accept job ${jobId}: Unknown error`
    };
}

// Function to get next 30 business days
function getNext30BusinessDays() {
    const days = [];
    let currentDate = new Date();
    
    while (days.length < 30) {
        currentDate.setDate(currentDate.getDate() + 1);
        const dayOfWeek = currentDate.getDay();
        // Skip weekends (0 = Sunday, 6 = Saturday)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            days.push(new Date(currentDate));
        }
    }
    
    return days;
}

// Function to login and maintain session
async function loginAndMaintainSession() {
    // If we have a valid session (less than 30 minutes old), return it
    if (browser && page && sessionCookies && lastLoginTime) {
        const sessionAge = Date.now() - lastLoginTime;
        const thirtyMinutes = 30 * 60 * 1000;
        
        if (sessionAge < thirtyMinutes) {
            console.log('Using existing session (age:', Math.round(sessionAge / 60000), 'minutes)');
            try {
                // Test if session is still valid by checking current page
                const currentUrl = page.url();
                if (currentUrl.includes('frontlineeducation.com') && !currentUrl.includes('login')) {
                    console.log('Session is still valid');
                    return { browser, page };
                }
            } catch (error) {
                console.log('Session test failed, will re-login');
            }
        } else {
            console.log('Session expired (age:', Math.round(sessionAge / 60000), 'minutes), re-logging in');
        }
    }

    // Need to login or re-login
    console.log('Logging into Aesop...');
    
    // Close existing browser if it exists
    if (browser) {
        try {
            await browser.close();
        } catch (error) {
            console.log('Error closing existing browser:', error.message);
        }
    }

    // Launch new browser
    browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    // Set default timeouts to be more forgiving
    page.setDefaultTimeout(45000);
    page.setDefaultNavigationTimeout(60000);

    console.log('Navigating to Aesop login page...');
    await page.goto(CONFIG.aesopUrl, { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
    }).catch(error => {
        throw new Error(`Failed to navigate to Aesop login page: ${error.message}`);
    });

    console.log('Waiting for login form to load...');
    try {
        await page.waitForSelector('#Username', { timeout: 10000 });
        await page.waitForSelector('#Password', { timeout: 10000 });
    } catch (error) {
        throw new Error(`Login form not found: ${error.message}`);
    }

    console.log('Filling in credentials...');
    await page.click('#Username', { clickCount: 3 });
    await page.type('#Username', CONFIG.username, { delay: 50 });
    
    await page.click('#Password', { clickCount: 3 });
    await page.type('#Password', CONFIG.password, { delay: 50 });

    console.log('Submitting login...');
    try {
        // Try multiple possible login button selectors
        const loginSelectors = [
            '#qa-button-login',
            'button[type="submit"]',
            'input[type="submit"]',
            '.btn-login',
            '.login-button',
            '[data-testid="login-button"]',
            'button:contains("Login")',
            'button:contains("Sign In")',
            'button:contains("Log In")',
            '#loginSubmit',
            '.submit-button'
        ];
        
        let loginButton = null;
        for (const selector of loginSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                loginButton = selector;
                console.log(`Found login button with selector: ${selector}`);
                break;
            } catch (e) {
                // Try next selector
                continue;
            }
        }
        
        if (!loginButton) {
            throw new Error('Login button not found with any selector');
        }
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
            page.click(loginButton)
        ]);
    } catch (error) {
        console.log('Login navigation timeout, trying alternative approach...');
        
        // Try alternative approach - wait for URL change or specific element
        try {
            await page.click(loginButton || 'button[type="submit"]');
            console.log('Login clicked, waiting for redirect...');
            
            // Wait up to 45 seconds for either URL change or dashboard element
            await Promise.race([
                page.waitForNavigation({ waitUntil: 'load', timeout: 45000 }),
                page.waitForSelector('#dashboard, .dashboard, [data-testid="dashboard"], .main-content', { timeout: 45000 }),
                new Promise(resolve => setTimeout(resolve, 45000))
            ]);
            
            console.log('Login successful with alternative approach');
        } catch (altError) {
            // Final fallback - just wait and check if we're logged in
            console.log('Alternative approach failed, trying final fallback...');
            await page.click(loginButton || 'button[type="submit"]');
            await new Promise(resolve => setTimeout(resolve, 8000));
            
            // Check if login was successful by looking for login-related elements
            const isLoggedIn = await page.evaluate(() => {
                return !document.querySelector('#Username') && 
                       (document.querySelector('.dashboard') || 
                        document.querySelector('[data-testid="dashboard"]') ||
                        window.location.href.includes('dashboard') ||
                        window.location.href.includes('home'));
            });
            
            if (!isLoggedIn) {
                throw new Error(`Login submission failed after multiple attempts: ${error.message}`);
            }
            
            console.log('Login successful with fallback approach');
        }
    }

    console.log('Login submitted, waiting for page to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const currentUrl = page.url();
    console.log('Current URL after login:', currentUrl);
    
    if (currentUrl.includes('login')) {
        throw new Error('Login failed - still on login page');
    }

    // Save session cookies
    try {
        sessionCookies = await page.cookies();
        lastLoginTime = Date.now();
        console.log('Session cookies saved successfully');
    } catch (error) {
        console.log('Error saving session cookies:', error.message);
    }

    // Wait for any dynamic content to load after login
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return { browser, page };
}

// Function to check for shifts
async function checkForShifts() {
    if (isChecking) {
        console.log('Check already in progress, skipping...');
        return;
    }

    isChecking = true;
    console.log(`[${new Date().toLocaleString()}] Checking for shifts...`);
    
    let error = null; // Track if there was an error

    // Periodic Chrome cleanup to prevent orphaned processes
    await cleanupChromeProcesses();

    // Validate required configuration
    if (!CONFIG.username || !CONFIG.password) {
        throw new Error('Missing AESOP_USERNAME or AESOP_PASSWORD in environment variables');
    }
    if (!CONFIG.emailFrom || !CONFIG.emailPassword) {
        throw new Error('Missing EMAIL_FROM or EMAIL_PASSWORD in environment variables');
    }

    try {
        // Use session management
        const { browser: currentBrowser, page: currentPage } = await loginAndMaintainSession();
        
        // Update global variables
        browser = currentBrowser;
        page = currentPage;

        // Save the page HTML after login for debugging
        try {
            console.log('Getting page content...');
            const afterLoginHtml = await page.content();
            console.log(`Page content length: ${afterLoginHtml ? afterLoginHtml.length : 0} characters`);
            
            if (afterLoginHtml && afterLoginHtml.length > 1000) {
                require('fs').writeFileSync('after-login.html', afterLoginHtml);
                console.log('After-login HTML saved to after-login.html');
                
                // Also save a smaller preview for debugging
                const preview = afterLoginHtml.substring(0, 2000);
                require('fs').writeFileSync('after-login-preview.html', preview);
                console.log('After-login preview saved to after-login-preview.html');
                
                await page.screenshot({ path: 'after-login.png', fullPage: true });
                console.log('After-login screenshot saved');
            } else {
                console.warn('After-login HTML appears to be empty or too short');
                console.log('Page title:', await page.title());
                console.log('Page URL:', page.url());
                
                // Try to get some basic content
                try {
                    const bodyText = await page.evaluate(() => document.body?.innerText || 'No body text');
                    console.log('Body text preview:', bodyText.substring(0, 200));
                } catch (e) {
                    console.log('Could not get body text:', e.message);
                }
            }
        } catch (saveError) {
            console.error('Error saving after-login files:', saveError);
        }

        // Extract jobs directly from the saved after-login.html file
        console.log('Extracting jobs directly from after-login.html file...');
        
        let shifts = [];
        try {
            // Read the after-login.html file directly
            const fs = require('fs');
            const afterLoginHtml = fs.readFileSync('after-login.html', 'utf8');
            console.log('Read after-login.html file, length:', afterLoginHtml.length);
            
            // Parse the pageVars object to get availJobs
            const pageVarsMatch = afterLoginHtml.match(/var pageVars = ({[\s\S]*?});/);
            console.log(`pageVars match: ${!!pageVarsMatch}`);
            
            if (pageVarsMatch) {
                try {
                    // Extract just the object part, removing "var pageVars = " and trailing ";"
                    const pageVarsText = pageVarsMatch[0].replace(/^var pageVars = /, '').replace(/;$/, '');
                    console.log(`pageVars text length: ${pageVarsText.length}`);
                    console.log(`pageVars text preview: ${pageVarsText.substring(0, 500)}...`);
                    
                    // Use eval to parse the JavaScript object
                    const pageVars = eval(`(${pageVarsText})`);
                    
                    console.log(`pageVars keys:`, Object.keys(pageVars));
                    console.log(`pageVars.availJobs: ${!!pageVars.availJobs}`);
                    if (pageVars.availJobs) {
                        console.log(`pageVars.availJobs keys:`, Object.keys(pageVars.availJobs));
                    
            if (pageVars && pageVars.availJobs && pageVars.availJobs.list) {
                console.log(`📊 Found ${pageVars.availJobs.list.length} jobs in pageVars.availJobs.list`);
                        
                for (const job of pageVars.availJobs.list) {
                    console.log(`🔍 PAGEVARS JOB DEBUG: ID=${job.Id}, Title=${job.WorkerTitle}, SubstituteId=${job.SubstituteId}`);
                            console.log(`Items count: ${job.Items ? job.Items.length : 0}`);
                            console.log(`SubstituteId: ${job.SubstituteId}`);
                            
                            // Only process jobs with SubstituteId: null (available jobs)
                            if (job.SubstituteId === null) {
                                // Accept all available jobs - no position filtering needed
                                console.log(`Processing available job: ${job.WorkerTitle}`);
                                
                                // Format date and time using Items array or Start/EndDate
                                let dateStr = 'N/A';
                                let timeStr = 'N/A';
                                
                                if (job.Items && job.Items.length > 0) {
                                    // Parse the Items array to get individual shifts
                                    const items = job.Items;
                                    const firstShift = items[0]; // First item is first day
                                    const lastShift = items[items.length - 1]; // Last item is last day
                                    
                                    const firstDate = new Date(firstShift.Start);
                                    const lastDate = new Date(lastShift.Start);
                                    
                                    // Check if it's a multi-day range
                                    if (firstDate.toDateString() !== lastDate.toDateString()) {
                                        dateStr = `${firstDate.toLocaleDateString()} - ${lastDate.toLocaleDateString()}`;
                                        console.log(`Using date range from Items: ${dateStr}`);
                                    } else {
                                        // Single day
                                        dateStr = firstDate.toLocaleDateString();
                                        console.log(`Using single date from Items: ${dateStr}`);
                                    }
                                    
                                    // Get time range from first and last shifts
                                    const firstTime = new Date(firstShift.Start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                    const lastTime = new Date(lastShift.End).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                    timeStr = `${firstTime} - ${lastTime}`;
                                    
                                } else if (job.Start && job.EndDate) {
                                    // Fallback to Start/EndDate fields
                                    const startDate = new Date(job.Start);
                                    const endDate = new Date(job.EndDate);
                                    
                                    if (startDate.toDateString() !== endDate.toDateString()) {
                                        dateStr = `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
                                        console.log(`Using date range from Start/EndDate: ${dateStr}`);
                                    } else {
                                        dateStr = startDate.toLocaleDateString();
                                        console.log(`Using single date from Start: ${dateStr}`);
                                    }
                                    
                                    const startTime = startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                    const endTime = endDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                    timeStr = `${startTime} - ${endTime}`;
                                }
                                
                                const shiftData = {
                                    id: job.Id,
                                    title: job.WorkerTitle,
                                    employee: `${job.WorkerFirstName} ${job.WorkerLastName}`.trim(),
                                    school: job.Items && job.Items[0] ? job.Items[0].Institution.Name : 'See details in Aesop',
                                    date: dateStr,
                                    time: timeStr,
                                    duration: job.Items && job.Items[0] ? job.Items[0].Duration.substring(0, 5) : 'N/A',
                                    foundAt: new Date().toISOString()
                                };
                                
                                // Auto-Accept Logic: Check if job is 48+ hours in future
                                if (CONFIG.autoAcceptEnabled) {
                                    const jobStartTime = job.Items && job.Items[0] ? new Date(job.Items[0].Start) : new Date(job.Start);
                                    const currentTime = new Date();
                                    const hoursInFuture = (jobStartTime - currentTime) / (1000 * 60 * 60);
                                    
                                    console.log(`🕐 AUTO-ACCEPT DEBUG: Job ${job.Id}`);
                                    console.log(`📅 Job Start Time: ${jobStartTime.toISOString()}`);
                                    console.log(`🕐 Current Time: ${currentTime.toISOString()}`);
                                    console.log(`⏰ Hours in Future: ${hoursInFuture.toFixed(1)}`);
                                    console.log(`🎯 Threshold: ${CONFIG.autoAcceptHoursInFuture} hours`);
                                    console.log(`🔧 Auto-Accept Enabled: ${CONFIG.autoAcceptEnabled}`);
                                    
                                    if (hoursInFuture >= CONFIG.autoAcceptHoursInFuture) {
                                        console.log(`🎯 AUTO-ACCEPT QUALIFIED: Job ${job.Id} is ${hoursInFuture.toFixed(1)} hours in future (>= ${CONFIG.autoAcceptHoursInFuture}h)`);
                                        
                                        if (CONFIG.autoAcceptLogOnly) {
                                            console.log(`📝 LOG ONLY MODE: Would auto-accept job ${job.Id} - ${job.WorkerTitle} at ${shiftData.school}`);
                                        } else {
                                            console.log(`🚀 AUTO-ACCEPTING: Job ${job.Id} - ${job.WorkerTitle} at ${shiftData.school}`);
                                            
                                            // Auto-accept the job in the background
                                            acceptJob(job.Id)
                                                .then(result => {
                                                    if (result.success) {
                                                        console.log(`✅ AUTO-ACCEPT SUCCESS: Job ${job.Id} accepted automatically!`);
                                                        
                                                        // Send special auto-accept notification
                                                        sendAutoAcceptNotification(shiftData, hoursInFuture);
                                                        
                                                        // Send immediate confirmation notification
                                                        sendAutoAcceptConfirmation(job.Id, shiftData, hoursInFuture);
                                                    } else {
                                                        console.log(`❌ AUTO-ACCEPT FAILED: Job ${job.Id} - ${result.message}`);
                                                        
                                                        // Send failure notification
                                                        sendAutoAcceptFailure(job.Id, shiftData, result.message);
                                                    }
                                                })
                                                .catch(error => {
                                                    console.error(`💥 AUTO-ACCEPT ERROR: Job ${job.Id} - ${error.message}`);
                                                    
                                                    // Send error notification
                                                    sendAutoAcceptFailure(job.Id, shiftData, error.message);
                                                });
                                        }
                                    } else {
                                        console.log(`⏰ NOT AUTO-ACCEPTING: Job ${job.Id} is only ${hoursInFuture.toFixed(1)} hours in future (< ${CONFIG.autoAcceptHoursInFuture}h)`);
                                    }
                                }
                                
                                console.log(`✅ ADDING JOB: ${job.WorkerTitle} at ${shiftData.school}`);
                                shifts.push(shiftData);
                            } else {
                                console.log(`❌ SKIPPING JOB - Already has substitute assigned: ${job.SubstituteId}`);
                            }
                            }
                        }
                    } else {
                        console.log('No availJobs.list found in pageVars');
                    }
                } catch (parseError) {
                    console.log('Error parsing pageVars with eval:', parseError.message);
                    
                    // Try to extract availJobs using regex as fallback
                    console.log('Trying regex fallback for availJobs...');
                    const availJobsRegex = /"availJobs":\{[^}]*"list":\s*\[([^\]]+)\]/;
                    const availJobsMatch = afterLoginHtml.match(availJobsRegex);
                    
                    if (availJobsMatch) {
                        console.log('Found availJobs with regex, parsing manually...');
                        const availJobsText = `[${availJobsMatch[1]}]`;
                        try {
                            const availJobs = JSON.parse(availJobsText);
                            console.log(`Found ${availJobs.length} jobs with regex fallback`);
                            
                            for (const job of availJobs) {
                                // Log all job details for debugging
                                console.log(`🔍 JOB DEBUG: ID=${job.Id}, Title=${job.WorkerTitle}, SubstituteId=${job.SubstituteId}, WorkerFirstName=${job.WorkerFirstName}, WorkerLastName=${job.WorkerLastName}`);
                                
                                if (job.SubstituteId === null) {
                                    // Add job processing logic here
                                    console.log(`✅ PROCESSING AVAILABLE JOB: ${job.Id} - ${job.WorkerTitle}`);
                                    // ... rest of job processing
                                }
                            }
                        } catch (regexError) {
                            console.log('Regex fallback also failed:', regexError.message);
                        }
                    }
                }
            } else {
                console.log('No pageVars object found in HTML');
                
                // Try alternative search for pageVars
                const altPageVarsMatch = afterLoginHtml.match(/pageVars\s*=\s*{[\s\S]*?}/);
                if (altPageVarsMatch) {
                    console.log('Found alternative pageVars match');
                    console.log('Alternative pageVars preview:', altPageVarsMatch[0].substring(0, 200));
                }
                
                // Try searching for curJobs
                const curJobsMatch = afterLoginHtml.match(/curJobs:\s*\[([^\]]+)\]/);
                if (curJobsMatch) {
                    console.log('Found curJobs array');
                    console.log('curJobs preview:', curJobsMatch[1].substring(0, 200));
                }
                
                // Try searching for availJobs
                const availJobsMatch = afterLoginHtml.match(/availJobs:\s*\{[^}]*list:\s*\[([^\]]+)\]/);
                if (availJobsMatch) {
                    console.log('Found availJobs object');
                    console.log('availJobs preview:', availJobsMatch[0].substring(0, 200));
                }
            }
            
        } catch (fileError) {
            console.error('Error reading after-login.html file:', fileError);
        }

        console.log(`Found ${shifts.length} potential shifts`);

        // No additional filtering needed - we already filtered during extraction
        const filteredShifts = shifts;

        console.log(`Filtered to ${filteredShifts.length} substitute teacher shifts`);

        if (filteredShifts.length > 0) {
            console.log('Sample shifts:', filteredShifts.slice(0, 3));
        }

        // Check for new shifts
        const newShifts = filteredShifts.filter(shift => 
            !notifiedShiftIds.has(shift.id)
        );

        console.log(`Found ${newShifts.length} new shifts`);

        if (newShifts.length > 0) {
            console.log('New shifts found:', newShifts);
            
            // Add new shifts to the notified set
            newShifts.forEach(shift => notifiedShiftIds.add(shift.id));
            
            console.log(`📊 Final shifts array has ${filteredShifts.length} shifts`);
            console.log('📋 filteredShifts preview:', JSON.stringify(filteredShifts.slice(0, 2), null, 2));
            availableShifts = [...filteredShifts];
            lastChecked = new Date();
            
            // Send email notification
            await sendEmailNotification(newShifts);
        } else {
            console.log('❌ No new shifts found');
            console.log(`📊 Final shifts array still has ${availableShifts.length} shifts`);
        }

        availableShifts = [...filteredShifts];
        lastChecked = new Date();

    } catch (err) {
        error = err; // Store the error for the finally block
        console.error('Error checking for shifts:', err);
        
        // Send error notification
        await sendErrorNotification(err, "Job Check Failed");
        
        // If there's an error, reset the session to force re-login next time
        console.log('Resetting session due to error...');
        sessionCookies = null;
        lastLoginTime = null;
        
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.log('Error closing browser after error:', closeError.message);
            }
            browser = null;
            page = null;
        }
    } finally {
        isChecking = false;
        
        // IMPORTANT: Always close browser after check to prevent memory leaks
        // This ensures Chrome instances don't accumulate on the VM
        if (browser && !error) {
            try {
                console.log('Closing browser after successful check to prevent memory leaks...');
                await browser.close();
                browser = null;
                page = null;
                console.log('Browser closed successfully');
            } catch (closeError) {
                console.log('Error closing browser after successful check:', closeError.message);
                browser = null;
                page = null;
            }
        }
    }
}

// Function to test email configuration
async function testEmailConfiguration() {
    if (!transporter) {
        console.log('Email transporter not configured - skipping email test');
        return false;
    }

    try {
        console.log('Testing email configuration...');
        await transporter.verify();
        console.log('Email configuration is valid!');
        return true;
    } catch (error) {
        console.error('Email configuration test failed:', error.message);
        return false;
    }
}

// Send immediate auto-accept confirmation notification
async function sendAutoAcceptConfirmation(jobId, shift, hoursInFuture) {
    if (!transporter) {
        console.log('Email transporter not configured - skipping auto-accept confirmation');
        return;
    }

    const mailOptions = {
        from: CONFIG.emailFrom,
        to: CONFIG.emailTo,
        subject: `🎉 CONFIRMED: Auto-Accepted Job ${jobId} - ${shift.title}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="margin: 0; font-size: 28px;">🎉 AUTO-ACCEPT CONFIRMED!</h1>
                    <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.9;">Job successfully accepted automatically</p>
                </div>
                
                <div style="padding: 30px; background-color: #f8f9fa;">
                    <div style="background-color: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #333; margin: 0 0 20px 0; font-size: 22px;">✅ Successfully Accepted</h2>
                        
                        <div style="background-color: #d4edda; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #28a745;">
                            <p style="margin: 0; color: #155724; font-weight: bold;">🎯 Job ID: ${jobId}</p>
                            <p style="margin: 5px 0 0 0; color: #155724;">Position: ${shift.title}</p>
                            <p style="margin: 5px 0 0 0; color: #155724;">School: ${shift.school}</p>
                            <p style="margin: 5px 0 0 0; color: #155724;">Date: ${shift.date}</p>
                            <p style="margin: 5px 0 0 0; color: #155724;">Time: ${shift.time}</p>
                            <p style="margin: 5px 0 0 0; color: #155724;">Hours in Future: ${hoursInFuture.toFixed(1)}h</p>
                        </div>
                        
                        <div style="text-align: center; margin-top: 25px;">
                            <a href="${CONFIG.aesopUrl}" 
                               target="_blank"
                               style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                                🔍 View in Aesop
                            </a>
                        </div>
                        
                        <p style="margin: 20px 0 0 0; font-size: 14px; color: #666; text-align: center; font-style: italic;">
                            💼 This job has been automatically accepted and confirmed in your Aesop account
                        </p>
                    </div>
                </div>
                
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #e9ecef;">
                    <p style="margin: 0; color: #666; font-size: 12px;">
                        🎉 Auto-accepted at ${new Date().toLocaleString()} | Aesop Shift Checker
                    </p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('✅ Auto-accept confirmation email sent successfully');
    } catch (error) {
        console.error('❌ Error sending auto-accept confirmation:', error);
    }
}

// Send auto-accept failure notification
async function sendAutoAcceptFailure(jobId, shift, errorMessage) {
    if (!transporter) {
        console.log('Email transporter not configured - skipping auto-accept failure notification');
        return;
    }

    const mailOptions = {
        from: CONFIG.emailFrom,
        to: CONFIG.emailTo,
        subject: `❌ FAILED: Auto-Accept Job ${jobId} - ${shift.title}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="margin: 0; font-size: 28px;">❌ AUTO-ACCEPT FAILED</h1>
                    <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.9;">Could not automatically accept job</p>
                </div>
                
                <div style="padding: 30px; background-color: #f8f9fa;">
                    <div style="background-color: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #333; margin: 0 0 20px 0; font-size: 22px;">❌ Acceptance Failed</h2>
                        
                        <div style="background-color: #f8d7da; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #dc3545;">
                            <p style="margin: 0; color: #721c24; font-weight: bold;">🎯 Job ID: ${jobId}</p>
                            <p style="margin: 5px 0 0 0; color: #721c24;">Position: ${shift.title}</p>
                            <p style="margin: 5px 0 0 0; color: #721c24;">School: ${shift.school}</p>
                            <p style="margin: 5px 0 0 0; color: #721c24;">Error: ${errorMessage}</p>
                        </div>
                        
                        <div style="text-align: center; margin-top: 25px;">
                            <a href="${CONFIG.aesopUrl}" 
                               target="_blank"
                               style="background-color: #dc3545; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                                🔍 Accept Manually in Aesop
                            </a>
                        </div>
                        
                        <p style="margin: 20px 0 0 0; font-size: 14px; color: #666; text-align: center; font-style: italic;">
                            ⚠️ Auto-accept failed - please accept this job manually in Aesop
                        </p>
                    </div>
                </div>
                
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #e9ecef;">
                    <p style="margin: 0; color: #666; font-size: 12px;">
                        ❌ Auto-accept failed at ${new Date().toLocaleString()} | Aesop Shift Checker
                    </p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('✅ Auto-accept failure email sent successfully');
    } catch (error) {
        console.error('❌ Error sending auto-accept failure:', error);
    }
}

// Send special auto-accept notification
async function sendAutoAcceptNotification(shift, hoursInFuture) {
    if (!transporter) {
        console.log('Email transporter not configured - skipping auto-accept notification');
        return;
    }

    const mailOptions = {
        from: CONFIG.emailFrom,
        to: CONFIG.emailTo,
        subject: `🚀 AUTO-ACCEPTED: ${shift.title} at ${shift.school}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="margin: 0; font-size: 28px;">🚀 Job Auto-Accepted!</h1>
                    <p style="margin: 10px 0 0 0; font-size: 18px; opacity: 0.9;">We automatically accepted this substitute position for you</p>
                </div>
                
                <div style="padding: 30px; background-color: #f8f9fa;">
                    <div style="background-color: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2 style="color: #333; margin: 0 0 20px 0; font-size: 22px;">🎯 Auto-Accepted Position</h2>
                        
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                            <div>
                                <p style="margin: 5px 0;"><strong style="color: #667eea;">👤 Teacher:</strong> ${shift.employee}</p>
                                <p style="margin: 5px 0;"><strong style="color: #667eea;">🏫 School:</strong> ${shift.school}</p>
                            </div>
                            <div>
                                <p style="margin: 5px 0;"><strong style="color: #667eea;">📅 Date:</strong> ${shift.date}</p>
                                <p style="margin: 5px 0;"><strong style="color: #667eea;">🕐 Time:</strong> ${shift.time}</p>
                            </div>
                        </div>
                        
                        <div style="background-color: #e8f5e8; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #28a745;">
                            <p style="margin: 0; color: #155724; font-weight: bold;">⏰ Auto-Accept Reason:</p>
                            <p style="margin: 5px 0 0 0; color: #155724;">Job was ${hoursInFuture.toFixed(1)} hours in the future (≥ ${CONFIG.autoAcceptHoursInFuture} hours)</p>
                        </div>
                        
                        <div style="text-align: center; margin-top: 25px;">
                            <a href="${CONFIG.aesopUrl}" 
                               target="_blank"
                               style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                                🔍 View in Aesop
                            </a>
                        </div>
                        
                        <p style="margin: 20px 0 0 0; font-size: 14px; color: #666; text-align: center; font-style: italic;">
                            💡 This job was automatically accepted because it meets your 48+ hour advance notice criteria
                        </p>
                    </div>
                </div>
                
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #e9ecef;">
                    <p style="margin: 0; color: #666; font-size: 12px;">
                        🚀 Auto-accepted at ${new Date().toLocaleString()} | Aesop Shift Checker
                    </p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('✅ Auto-accept notification sent successfully');
    } catch (error) {
        console.error('❌ Error sending auto-accept notification:', error);
    }
}

// Function to send email notification
async function sendEmailNotification(shifts) {
    if (!transporter) {
        console.log('Email transporter not configured - skipping email notification');
        return;
    }

    // Test email configuration before sending
    const isConfigValid = await testEmailConfiguration();
    if (!isConfigValid) {
        console.log('Email configuration is invalid - skipping notification');
        return;
    }

    const shiftsHtml = shifts.map(shift => `
        <div style="border: 1px solid #ddd; padding: 20px; margin: 15px 0; border-radius: 8px; background-color: #f9f9f9;">
            <h3 style="color: #2563eb; margin: 0 0 15px 0; font-size: 18px;">${shift.title}</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div>
                    <p style="margin: 5px 0;"><strong style="color: #333;">👤 Teacher:</strong> ${shift.employee || 'N/A'}</p>
                    <p style="margin: 5px 0;"><strong style="color: #333;">🏫 School:</strong> ${shift.school}</p>
                </div>
                <div>
                    <p style="margin: 5px 0;"><strong style="color: #333;">📅 Date:</strong> ${shift.date}</p>
                    <p style="margin: 5px 0;"><strong style="color: #333;">🕐 Time:</strong> ${shift.time}</p>
                </div>
            </div>
            ${shift.duration && shift.duration !== 'N/A' ? `<p style="margin: 5px 0;"><strong style="color: #333;">⏱️ Duration:</strong> ${shift.duration}</p>` : ''}
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee;">
                <a href="${CONFIG.publicUrl}/accept/${shift.id}" style="background-color: #28a745; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-right: 10px;">✅ Accept Job Instantly</a>
                <a href="${CONFIG.aesopUrl}" style="background-color: #6c757d; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">🔍 View in Aesop</a>
            </div>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #666; font-style: italic;">
                � Click "Accept Job Instantly" for one-click automated acceptance, or "View in Aesop" to accept manually.
            </p>
        </div>
    `).join('');

    const mailOptions = {
        from: CONFIG.emailFrom,
        to: CONFIG.emailTo,
        subject: `🔔 ${shifts.length} New Shift${shifts.length > 1 ? 's' : ''} Available - ${CONFIG.district}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="margin: 0; font-size: 24px;">🎯 New Substitute Opportunities</h1>
                    <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">${CONFIG.district}</p>
                </div>
                
                <div style="padding: 25px;">
                    <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                        <strong>Great news!</strong> We found ${shifts.length} new substitute teacher shift${shifts.length > 1 ? 's' : ''} matching your criteria:
                    </p>
                    
                    ${shiftsHtml}
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 20px; text-align: center;">
                        <p style="margin: 0 0 15px 0; color: #666;">
                            <strong>Quick Links:</strong>
                        </p>
                        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                            <a href="${CONFIG.publicUrl}" style="background-color: #007bff; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">📊 Dashboard</a>
                            <a href="${CONFIG.aesopUrl}" style="background-color: #28a745; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">🔐 Login to Aesop</a>
                        </div>
                    </div>
                    
                    <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 12px;">
                        <p style="margin: 0;">📧 Sent at ${new Date().toLocaleString()}</p>
                        <p style="margin: 5px 0 0 0;">Aesop Shift Checker - Automated Monitoring System</p>
                    </div>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Email notification sent successfully!');
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

// Function to send error notifications
async function sendErrorNotification(error, context = "Unknown") {
    if (!transporter) {
        console.log('Email transporter not configured - skipping error notification');
        return;
    }

    const errorDetails = {
        message: error.message,
        stack: error.stack,
        context: context,
        timestamp: new Date().toISOString(),
        vmInfo: {
            hostname: require('os').hostname(),
            uptime: require('os').uptime(),
            memory: process.memoryUsage()
        }
    };

    const mailOptions = {
        from: CONFIG.emailFrom,
        to: CONFIG.debugEmailTo, // Use debug email for error notifications
        subject: `🚨 Aesop Checker Error - ${context}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: #f44336; color: white; padding: 20px; text-align: center;">
                    <h2>🚨 Aesop Checker Error Alert</h2>
                </div>
                
                <div style="padding: 20px; background: #f9f9f9;">
                    <h3>Error Details:</h3>
                    <p><strong>Context:</strong> ${context}</p>
                    <p><strong>Time:</strong> ${errorDetails.timestamp}</p>
                    <p><strong>Error:</strong> ${error.message}</p>
                    
                    <h4>Stack Trace:</h4>
                    <pre style="background: #fff; padding: 10px; border-left: 4px solid #f44336; overflow-x: auto;">${error.stack}</pre>
                    
                    <h4>VM Information:</h4>
                    <ul>
                        <li><strong>Hostname:</strong> ${errorDetails.vmInfo.hostname}</li>
                        <li><strong>Uptime:</strong> ${Math.round(errorDetails.vmInfo.uptime / 60)} minutes</li>
                        <li><strong>Memory Used:</strong> ${Math.round(errorDetails.vmInfo.memory.heapUsed / 1024 / 1024)} MB</li>
                    </ul>
                </div>
                
                <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
                    <p>Aesop Shift Checker - Error Monitoring System</p>
                    <p>Server Time: ${new Date().toLocaleString()}</p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Error notification sent successfully!');
    } catch (emailError) {
        console.error('Error sending error notification:', emailError);
    }
}

// Periodic Chrome cleanup to prevent orphaned processes
async function cleanupChromeProcesses() {
    try {
        const { exec } = require('child_process');
        
        // Check for Chrome processes
        exec('pgrep -f chrome | wc -l', (error, stdout, stderr) => {
            if (!error) {
                const chromeProcessCount = parseInt(stdout.trim());
                console.log(`🔍 Found ${chromeProcessCount} Chrome processes`);
                
                if (chromeProcessCount > 5) { // If more than 5 Chrome processes, clean up
                    console.log('🧹 Too many Chrome processes detected, cleaning up...');
                    
                    exec('pkill -f chrome || true', (killError, killStdout, killStderr) => {
                        if (killError) {
                            console.log('Chrome cleanup error:', killError.message);
                        } else {
                            console.log('✅ Cleaned up orphaned Chrome processes');
                        }
                    });
                }
            }
        });
        
    } catch (error) {
        console.log('Chrome process check failed:', error.message);
    }
}

// Cleanup function for graceful shutdown
async function cleanup() {
    console.log('Cleaning up...');
    
    // Close our browser instance
    if (browser) {
        try {
            await browser.close();
            console.log('Browser closed');
        } catch (error) {
            console.log('Error closing browser during cleanup:', error.message);
        }
    }
    browser = null;
    page = null;
    sessionCookies = null;
    lastLoginTime = null;
    
    // Kill any orphaned Chrome processes (Linux/Unix)
    try {
        const { exec } = require('child_process');
        exec('pkill -f chrome || true', (error, stdout, stderr) => {
            if (error) {
                console.log('No Chrome processes to kill or error killing Chrome:', error.message);
            } else {
                console.log('🧹 Cleaned up orphaned Chrome processes');
            }
        });
        
        // Also try with chrome-browser variant
        exec('pkill -f chrome-browser || true', (error, stdout, stderr) => {
            if (error && error.code !== 1) {
                console.log('No chrome-browser processes to kill:', error.message);
            }
        });
        
    } catch (error) {
        console.log('Error in Chrome process cleanup:', error.message);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, cleaning up...');
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, cleaning up...');
    await cleanup();
    process.exit(0);
});

// Global error handlers
process.on('uncaughtException', async (error) => {
    console.error('Uncaught Exception:', error);
    await sendErrorNotification(error, "Uncaught Exception");
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await sendErrorNotification(new Error(reason), "Unhandled Promise Rejection");
});

// API endpoint for Android app to get shifts
app.get('/api/shifts', (req, res) => {
    console.log(`📊 API /api/shifts called - returning ${availableShifts.length} shifts`);
    console.log('📋 availableShifts array:', JSON.stringify(availableShifts, null, 2));
    console.log('🕐 lastChecked:', lastChecked);
    
    res.json({
        success: true,
        shifts: availableShifts,
        lastChecked: lastChecked,
        timestamp: new Date().toISOString()
    });
});

// API endpoint for Android app to check jobs (with push notification support)
app.post('/api/check-jobs', async (req, res) => {
    try {
        const { fcmToken, deviceId } = req.body;
        
        // Save FCM token for this device
        if (fcmToken) {
            // You could store this in a database or file
            console.log(`FCM token for device ${deviceId}: ${fcmToken}`);
            
            // For now, just log it - in production, store it in a database
            const fs = require('fs');
            const tokens = {};
            try {
                const existingTokens = fs.readFileSync('fcm-tokens.json', 'utf8');
                Object.assign(tokens, JSON.parse(existingTokens));
            } catch (e) {
                // File doesn't exist, that's ok
            }
            tokens[deviceId] = { fcmToken, lastSeen: new Date().toISOString() };
            fs.writeFileSync('fcm-tokens.json', JSON.stringify(tokens, null, 2));
        }
        
        // Trigger a job check
        await checkForShifts();
        
        // Get new jobs that weren't previously notified
        const newJobs = availableShifts.filter(shift => 
            !notifiedShiftIds.has(shift.id)
        );
        
        if (newJobs.length > 0) {
            // Send push notifications
            await sendPushNotifications(newJobs, fcmToken);
            
            // Mark as notified
            newJobs.forEach(shift => notifiedShiftIds.add(shift.id));
        }
        
        res.json({
            success: true,
            newJobs: newJobs,
            totalJobs: availableShifts.length,
            message: newJobs.length > 0 ? `Found ${newJobs.length} new jobs` : 'No new jobs'
        });
        
    } catch (error) {
        console.error('Error in /api/check-jobs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Function to send push notifications
async function sendPushNotifications(jobs, fcmToken) {
    if (!fcmToken) {
        console.log('No FCM token provided, skipping push notification');
        return;
    }
    
    try {
        const admin = require('firebase-admin');
        
        // Initialize Firebase Admin SDK if not already done
        if (!admin.apps.length) {
            const serviceAccount = require('./firebase-service-account.json');
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
        
        const message = {
            token: fcmToken,
            notification: {
                title: '🔔 New Aesop Jobs Available!',
                body: `${jobs.length} new job${jobs.length > 1 ? 's' : ''} found: ${jobs.map(j => j.title).join(', ')}`
            },
            data: {
                type: 'new_jobs',
                jobCount: jobs.length.toString(),
                jobs: JSON.stringify(jobs)
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    clickAction: 'FLUTTER_NOTIFICATION_CLICK'
                }
            }
        };
        
        const response = await admin.messaging().send(message);
        console.log('Push notification sent successfully:', response);
        
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        lastCheck: lastChecked,
        isChecking: isChecking
    };
    
    res.json(health);
});

// Detailed health check endpoint
app.get('/health/detailed', (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        lastCheck: lastChecked,
        isChecking: isChecking,
        availableShifts: availableShifts.length,
        notifiedShifts: notifiedShiftIds.size,
        browserOpen: !!browser,
        pageOpen: !!page
    };
    
    res.json(health);
});

// Start the Express server
const PORT = 3000;
app.listen(PORT, async () => {
    console.log(`Dashboard available at http://localhost:${PORT}`);
    console.log(`Checking for shifts every ${CONFIG.checkInterval / 60000} minutes`);
    
    // Test email configuration on startup
    console.log('\n=== Email Configuration Test ===');
    await testEmailConfiguration();
    console.log('================================\n');
    
    // Set up periodic Chrome cleanup (every 30 minutes)
    setInterval(async () => {
        console.log('🧹 Running periodic Chrome cleanup...');
        await cleanupChromeProcesses();
    }, 30 * 60 * 1000); // 30 minutes
    
    // Initial Chrome cleanup on startup
    console.log('🧹 Running initial Chrome cleanup...');
    await cleanupChromeProcesses();
    
    // Start the job checking interval
    setInterval(async () => {
        try {
            await checkForShifts();
        } catch (error) {
            console.error('Error in scheduled job check:', error);
        }
    }, CONFIG.checkInterval);
    
    // Run initial check
    await checkForShifts();
});
