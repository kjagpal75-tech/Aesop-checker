// Unified Session Management Enhancement
// This file contains the modifications needed to maintain browser session across login, job checking, and job acceptance

// Add these variables to the top of your aesop-checker.js file (after existing variables)

// Unified session management
let unifiedBrowser = null;
let unifiedPage = null;
let unifiedSessionId = null;
let lastSessionActivity = null;
const UNIFIED_SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Function to get or create unified browser session
async function getUnifiedSession() {
    try {
        // Check if existing session is still valid
        if (unifiedBrowser && unifiedBrowser.isConnected() && 
            unifiedPage && !unifiedPage.isClosed() &&
            lastSessionActivity && (Date.now() - lastSessionActivity < UNIFIED_SESSION_TIMEOUT)) {
            
            console.log('🔄 Reusing unified browser session');
            lastSessionActivity = Date.now();
            return { browser: unifiedBrowser, page: unifiedPage };
        }
        
        // Close old session if it exists
        if (unifiedBrowser) {
            try {
                await unifiedBrowser.close();
            } catch (error) {
                console.log('Error closing old unified browser:', error.message);
            }
        }
        
        // Create new unified session
        console.log('🚀 Creating new unified browser session');
        unifiedBrowser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        });

        unifiedPage = await unifiedBrowser.newPage();
        await unifiedPage.setViewport({ width: 1280, height: 800 });
        
        // Set more forgiving timeouts
        unifiedPage.setDefaultTimeout(60000);
        unifiedPage.setDefaultNavigationTimeout(90000);
        
        // Generate session ID
        unifiedSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        lastSessionActivity = Date.now();
        
        console.log(`🆔 New unified session created: ${unifiedSessionId}`);
        
        return { browser: unifiedBrowser, page: unifiedPage };
        
    } catch (error) {
        console.log('❌ Error creating unified session:', error.message);
        // Reset session on error
        await resetUnifiedSession();
        throw error;
    }
}

// Function to reset unified session
async function resetUnifiedSession() {
    try {
        if (unifiedBrowser) {
            await unifiedBrowser.close();
        }
    } catch (error) {
        console.log('Error closing unified browser during reset:', error.message);
    }
    unifiedBrowser = null;
    unifiedPage = null;
    unifiedSessionId = null;
    lastSessionActivity = null;
}

// Function to update session activity
function updateSessionActivity() {
    lastSessionActivity = Date.now();
}

// Modified loginAndMaintainSession function to use unified session
async function loginAndMaintainSession() {
    // Get unified session
    const session = await getUnifiedSession();
    let browser = session.browser;
    let page = session.page;
    
    // Check if we have a valid login session (less than 30 minutes old)
    if (sessionCookies && lastLoginTime) {
        const sessionAge = Date.now() - lastLoginTime;
        const thirtyMinutes = 30 * 60 * 1000;
        
        if (sessionAge < thirtyMinutes) {
            console.log('Using existing login session (age:', Math.round(sessionAge / 60000), 'minutes)');
            try {
                // Test if session is still valid by checking current page
                const currentUrl = page.url();
                if (currentUrl.includes('frontlineeducation.com') && !currentUrl.includes('login')) {
                    console.log('Login session is still valid');
                    updateSessionActivity();
                    return { browser, page };
                }
            } catch (error) {
                console.log('Session test failed, will re-login');
            }
        } else {
            console.log('Login session expired (age:', Math.round(sessionAge / 60000), 'minutes), re-logging in');
        }
    }

    // Need to login or re-login
    console.log('Logging into Aesop...');
    
    // Login to Aesop
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

    // Save session cookies and time
    sessionCookies = await page.cookies();
    lastLoginTime = Date.now();
    updateSessionActivity();
    
    console.log('✅ Login successful, session maintained');
    
    return { browser, page };
}

// Modified acceptJob function to use unified session
async function acceptJob(jobId) {
    console.log(`🎯 Attempting to accept job ${jobId} using unified session...`);
    
    let browser, page;
    try {
        // Get unified session (will reuse if available)
        const session = await getUnifiedSession();
        browser = session.browser;
        page = session.page;

        // Check if we need to login
        const currentUrl = page.url();
        if (!currentUrl.includes('frontlineeducation.com') || currentUrl.includes('login')) {
            console.log('Need to login for job acceptance...');
            const loginSession = await loginAndMaintainSession();
            browser = loginSession.browser;
            page = loginSession.page;
        }

        // Navigate to Available Jobs page
        console.log('Navigating to Available Jobs to accept job...');
        await page.goto('https://absencesub.frontlineeducation.com/Substitute/Schedule/AvailableJobs', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Look for and click the accept button for this specific job
        const acceptSuccess = await page.evaluate((jobId) => {
            const acceptButtons = document.querySelectorAll('button, input[type="button"], input[type="submit"], a');
            for (let button of acceptButtons) {
                const text = button.textContent || button.value || button.title || '';
                const onclick = button.getAttribute('onclick') || '';
                
                if ((text.toLowerCase().includes('accept') || onclick.toLowerCase().includes('accept')) &&
                    (onclick.includes(jobId) || button.getAttribute('data-job-id') === jobId || 
                     button.closest('tr')?.getAttribute('data-job-id') === jobId)) {
                    button.click();
                    return true;
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

            updateSessionActivity();
            
            return {
                success: true,
                message: `Successfully accepted job ${jobId}`,
                confirmed: confirmation
            };
        } else {
            updateSessionActivity();
            return {
                success: false,
                message: `Could not find accept button for job ${jobId}. Job may no longer be available.`
            };
        }

    } catch (error) {
        // Reset session on error
        console.log('❌ Accept job error, resetting unified session:', error.message);
        await resetUnifiedSession();
        throw error;
    }
}

// Add this to your periodic cleanup
async function cleanupUnifiedSession() {
    try {
        if (unifiedBrowser && lastSessionActivity) {
            const sessionAge = Date.now() - lastSessionActivity;
            if (sessionAge > UNIFIED_SESSION_TIMEOUT) {
                console.log('🧹 Cleaning up old unified session');
                await resetUnifiedSession();
            }
        }
    } catch (error) {
        console.log('Error during unified session cleanup:', error.message);
    }
}

// Add this to your existing cleanup interval
// In your server startup code, add this line to the existing setInterval:
// await cleanupUnifiedSession();
