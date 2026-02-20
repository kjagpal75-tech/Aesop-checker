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
    
    try {
        // Wait for the check to complete
        await checkForShifts();
        res.json({ 
            message: 'Check completed',
            lastChecked: lastChecked,
            shiftsFound: availableShifts.length
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Check failed', 
            error: error.message 
        });
    }
});

// Add job acceptance endpoint
app.get('/api/accept-job/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    console.log(`Received request to accept job: ${jobId}`);
    
    try {
        // For API endpoint, we need to create a new browser session since we don't have an existing one
        console.log('🔄 Creating new browser session for API endpoint request...');
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // Login to Aesop
        console.log('🔐 Logging in to accept job...');
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

        // Use acceptJobWithSession with the new browser session
        const result = await acceptJobWithSession(jobId, browser, page);
        
        // Close browser after API request
        await browser.close();
        
        res.json(result);
    } catch (error) {
        console.error('Error accepting job:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Function to accept a job with existing browser session
async function acceptJobWithSession(jobId, browser, page) {
    console.log(`🎯 Accepting job ${jobId} with existing browser session...`);
    
    try {
        // Test if browser is still connected
        if (!browser.isConnected()) {
            throw new Error('Browser connection lost - Target closed');
        }
        
        // Test if page is still valid
        if (page.isClosed()) {
            throw new Error('Page is closed - cannot accept job');
        }
        
        // Check if we're still logged in
        const currentUrl = page.url();
        if (!currentUrl.includes('frontlineeducation.com') || currentUrl.includes('login')) {
            console.log('❌ Session expired, need to re-login');
            throw new Error('Session expired - need to re-login');
        }
        
        console.log('✅ Using existing logged-in session');
        
        // Navigate to Available Jobs page
        console.log('🔍 Navigating to Available Jobs page...');
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
                        console.log(`✅ Found accept button for job ${targetJobId}`);
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

            return {
                success: true,
                message: `✅ Successfully accepted job ${jobId}`,
                confirmed: confirmation
            };
        } else {
            return {
                success: false,
                message: `❌ Could not find accept button for job ${jobId}. Job may no longer be available.`
            };
        }

    } catch (error) {
        console.error('❌ Error accepting job:', error);
        throw error;
    }
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
    
    // Assign to global variables for session continuity
    global.browser = browser;
    global.page = page;

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
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            page.click('#qa-button-login')
        ]);
    } catch (error) {
        throw new Error(`Login submission failed: ${error.message}`);
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
                    
                    // Use Function constructor instead of eval for better security
                    const pageVars = new Function(`return ${pageVarsText}`)();
                    
                    console.log(`pageVars keys:`, Object.keys(pageVars));
                    console.log(`pageVars.availJobs: ${!!pageVars.availJobs}`);
                    if (pageVars.availJobs) {
                        console.log(`pageVars.availJobs keys:`, Object.keys(pageVars.availJobs));
                        console.log(`pageVars.availJobs.list: ${!!pageVars.availJobs.list}`);
                        console.log(`pageVars.availJobs.fromDb: ${pageVars.availJobs.fromDb}`);
                    }
                    
                    if (pageVars && pageVars.availJobs && pageVars.availJobs.list) {
                        console.log(`Found ${pageVars.availJobs.list.length} available jobs in pageVars.availJobs.list`);
                        
                        for (const job of pageVars.availJobs.list) {
                            console.log(`\n--- Processing job from pageVars.availJobs.list ---`);
                            console.log(`Job ID: ${job.Id}`);
                            console.log(`Title: ${job.WorkerTitle}`);
                            console.log(`Employee: ${job.WorkerFirstName} ${job.WorkerLastName}`);
                            console.log(`School: ${job.Items && job.Items[0] ? job.Items[0].Institution.Name : 'N/A'}`);
                            console.log(`Start: ${job.Start}`);
                            console.log(`EndDate: ${job.EndDate}`);
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
                                    const firstShift = items[items.length - 1]; // Last item is first day
                                    const lastShift = items[0]; // First item is last day
                                    
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
                                
                                console.log(`✅ ADDING JOB: ${job.WorkerTitle} at ${shiftData.school}`);
                                shifts.push(shiftData);
                            } else {
                                console.log(`❌ SKIPPING JOB - Already has substitute assigned: ${job.SubstituteId}`);
                            }
                        }
                    } else {
                        console.log('No availJobs.list found in pageVars');
                    }
                } catch (parseError) {
                    console.log('Error parsing pageVars with eval:', parseError.message);
                    console.log('Parse error details:', parseError.stack);
                    
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
                                // Process each job...
                                if (job.SubstituteId === null) {
                                    // Add job processing logic here
                                    console.log(`Found available job: ${job.Id} - ${job.WorkerTitle}`);
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
            
            // Update available shifts for dashboard
            availableShifts = [...filteredShifts];
            lastChecked = new Date();
            
            // Send email notification
            await sendEmailNotification(newShifts);
            
            // AUTO-ACCEPT: Check for jobs that meet auto-accept criteria
            if (CONFIG.autoAcceptEnabled) {
                const autoAcceptCandidates = newShifts.filter(shift => {
                    // Calculate hours in future - handle date parsing more robustly
                    let shiftDate;
                    try {
                        // Try to parse the shift date - handle various date formats
                        if (shift.foundAt) {
                            // Use the foundAt timestamp which is in ISO format
                            shiftDate = new Date(shift.foundAt);
                        } else {
                            // Fallback to parsing the date field
                            shiftDate = new Date(shift.date);
                        }
                        
                        // If date is invalid, skip this shift
                        if (isNaN(shiftDate.getTime())) {
                            console.log(`❌ AUTO-ACCEPT: Invalid date for shift ${shift.id}: ${shift.date}`);
                            return false;
                        }
                    } catch (error) {
                        console.log(`❌ AUTO-ACCEPT: Date parsing error for shift ${shift.id}: ${error.message}`);
                        return false;
                    }
                    
                    const now = new Date();
                    const hoursInFuture = (shiftDate - now) / (1000 * 60 * 60);
                    
                    console.log(`🔧 AUTO-ACCEPT DEBUG: Processing shift ${shift.id}`);
                    console.log(`📅 Shift Date: ${shiftDate.toISOString()}`);
                    console.log(`🕐 Current Time: ${now.toISOString()}`);
                    console.log(`⏰ Hours in Future: ${hoursInFuture.toFixed(2)}`);
                    console.log(`🎯 Threshold: ${CONFIG.autoAcceptHoursInFuture} hours`);
                    console.log(`✅ Auto-Accept: ${hoursInFuture >= CONFIG.autoAcceptHoursInFuture ? 'YES' : 'NO'}`);
                    
                    return hoursInFuture >= CONFIG.autoAcceptHoursInFuture;
                });
                
                if (autoAcceptCandidates.length > 0) {
                    console.log(`🚀 AUTO-ACCEPTING: Found ${autoAcceptCandidates.length} candidates`);
                    
                    // 🔄 PREVENT BROWSER CLOSING DURING AUTO-ACCEPT
                    // Store the original browser and page to prevent them from being closed
                    const originalBrowser = browser;
                    const originalPage = page;
                    
                    for (const shift of autoAcceptCandidates) {
                        console.log(`🚀 AUTO-ACCEPTING: Shift ${shift.id} - ${shift.title} at ${shift.school}`);
                        
                        // Ensure browser and page are still valid before accepting
                        if (!originalBrowser || !originalPage || originalPage.isClosed()) {
                            console.log(`❌ Browser session lost before accepting shift ${shift.id}`);
                            continue;
                        }
                        
                        // Pass browser and page directly to acceptJob function
                        try {
                            const result = await acceptJobWithSession(shift.id, originalBrowser, originalPage);
                            if (result.success) {
                                console.log(`✅ AUTO-ACCEPT SUCCESS: ${result.message}`);
                            } else {
                                console.log(`❌ AUTO-ACCEPT FAILED: ${result.message}`);
                            }
                        } catch (error) {
                            console.error(`💥 AUTO-ACCEPT ERROR: Shift ${shift.id} - ${error.message}`);
                        }
                    }
                    
                    // 🔄 RESTORE BROWSER VARIABLES AFTER AUTO-ACCEPT
                    browser = originalBrowser;
                    page = originalPage;
                }
            }
        } else {
            console.log('No new shifts found');
            // Update lastChecked timestamp even when no new shifts found
            lastChecked = new Date();
        }
        
        // Add a small delay to ensure checking status is visible in dashboard
        if (CONFIG.checkInterval < 5000) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

    } catch (error) {
        console.error('Error checking for shifts:', error);
        
        // Send error notification
        await sendErrorNotification(error, "Job Check Failed");
        
        // If there's an error, reset the session to force re-login next time
        console.log('Resetting session due to error...');
        sessionCookies = null;
        lastLoginTime = null;
        
        // 🔄 ONLY CLOSE BROWSER IF NO AUTO-ACCEPT CANDIDATES
        // Check if there are any auto-accept candidates that might be processing
        // Use filteredShifts instead of newShifts since newShifts is not in scope here
        const hasAutoAcceptCandidates = filteredShifts.some(shift => {
            // Use the same robust date parsing as in the main auto-accept logic
            let shiftDate;
            try {
                if (shift.foundAt) {
                    shiftDate = new Date(shift.foundAt);
                } else {
                    shiftDate = new Date(shift.date);
                }
                
                if (isNaN(shiftDate.getTime())) {
                    return false;
                }
            } catch (error) {
                return false;
            }
            
            const now = new Date();
            const hoursInFuture = (shiftDate - now) / (1000 * 60 * 60);
            return CONFIG.autoAcceptEnabled && hoursInFuture >= CONFIG.autoAcceptHoursInFuture;
        });
        
        if (browser && !hasAutoAcceptCandidates) {
            console.log('🔄 No auto-accept candidates, closing browser session');
            try {
                await browser.close();
                console.log('✅ Browser closed successfully after error');
            } catch (closeError) {
                console.log('Error closing browser after error:', closeError.message);
            }
            browser = null;
            page = null;
            // Also clear global variables
            global.browser = null;
            global.page = null;
        } else if (browser && hasAutoAcceptCandidates) {
            console.log('🔄 Keeping browser session alive for potential auto-accept candidates');
        } else {
            console.log('ℹ️ No browser session to manage');
        }
    } finally {
        isChecking = false;
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
                <a href="http://localhost:3000/api/accept-job/${shift.id}" style="background-color: #28a745; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-right: 10px;">✅ Accept Job</a>
                <a href="${CONFIG.aesopUrl}" style="background-color: #6c757d; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">🔍 View in Aesop</a>
            </div>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #666; font-style: italic;">
                ⚠️ Accept button works when connected to your local network. Otherwise, login to Aesop directly.
            </p>
        </div>
    `).join('');

    // Prepare recipients for job notifications
    const recipients = [CONFIG.emailTo];
    if (CONFIG.jobNotificationTo) {
        recipients.push(CONFIG.jobNotificationTo.trim());
    }
    
    const mailOptions = {
        from: CONFIG.emailFrom,
        to: recipients.join(', '),
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
                            <a href="http://localhost:3000" style="background-color: #007bff; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">📊 Dashboard</a>
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
        to: CONFIG.emailTo,
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

// Cleanup function for graceful shutdown
async function cleanup() {
    console.log('Cleaning up...');
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

// API endpoint for Android app to get shifts (enhanced version)
app.get('/api/shifts/android', (req, res) => {
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
    
    // Initial check
    checkForShifts();
    
    // Set up periodic checking
    setInterval(checkForShifts, CONFIG.checkInterval);
});
