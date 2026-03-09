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
    // Add cache-busting headers to prevent stale data
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*'
    });
    
    console.log(`🔍 API CALLED: Returning ${availableShifts.length} jobs from availableShifts array`);
    console.log(`🔍 API CONTENT: ${availableShifts.map(s => `${s.id}-${s.school}`).join(', ')}`);
    
    res.json({
        shifts: availableShifts,
        lastChecked: lastChecked,
        isChecking: isChecking
    });
});

// Debug endpoint to check raw availableShifts array
app.get('/api/debug', (req, res) => {
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
    });
    
    res.json({
        availableShiftsLength: availableShifts.length,
        availableShifts: availableShifts,
        lastChecked: lastChecked,
        isChecking: isChecking,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/check-now', async (req, res) => {
    if (isChecking) {
        return res.json({ message: 'Check already in progress' });
    }
    
    try {
        // Wait for the check to complete
        await checkForShifts();
        // Wait for page to load completely
        await page.waitForTimeout(5000);
            
        // Wait additional time for dynamic content to load
        console.log('Waiting for dynamic job loading...');
        await page.waitForTimeout(3000);
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

// Safe logging function to prevent EIO errors
function safeLog(message) {
    try {
        console.log(message);
    } catch (error) {
        // Silently handle logging errors to prevent crashes
        if (error.code !== 'EIO') {
            // Only re-throw if it's not an EIO error
            throw error;
        }
    }
}

// Function to check for shifts
async function checkForShifts() {
    if (isChecking) {
        console.log('Check already in progress, skipping...');
        return;
    }

    isChecking = true;
    
    // CRITICAL: Clear stale data immediately to prevent showing old jobs
    console.log(`🗑️ CLEARING STALE DATA: Removing ${availableShifts.length} old jobs from dashboard`);
    console.log(`🗑️ OLD JOBS: ${availableShifts.map(s => `${s.id}-${s.school}`).join(', ')}`);
    availableShifts.length = 0;
    availableShifts = [];
    
    safeLog(`[${new Date().toLocaleString()}] Checking for shifts...`);

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
            
            // Wait additional time for dynamic job loading after page content is captured
            console.log('Waiting for dynamic job loading...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Get fresh page content after dynamic loading
            const afterLoginHtmlUpdated = await page.content();
            console.log(`Updated page content length: ${afterLoginHtmlUpdated ? afterLoginHtmlUpdated.length : 0} characters`);
            
            if (afterLoginHtmlUpdated && afterLoginHtmlUpdated.length > 1000) {
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

        // Helper function to extract job data from job object
function extractJobData(job) {
    // Only process jobs with SubstituteId: null (available jobs)
    if (job.SubstituteId !== null) {
        console.log(`❌ SKIPPING JOB - Already has substitute assigned: ${job.SubstituteId}`);
        return null;
    }
    
    console.log(`Processing available job: ${job.WorkerTitle}`);
    
    // Format date and time using Items array or Start/EndDate
    let dateStr = 'N/A';
    let timeStr = 'N/A';
    
    if (job.Items && job.Items.length > 0) {
        // Parse the Items array to get individual shifts
        const items = job.Items;
        
        // Sort items by Start date to ensure correct chronological order
        const sortedItems = [...items].sort((a, b) => 
            new Date(a.Start) - new Date(b.Start)
        );
        
        const firstShift = sortedItems[0];
        const lastShift = sortedItems[sortedItems.length - 1];
        
        const firstDate = new Date(firstShift.Start);
        const lastDate = new Date(lastShift.Start);
        
        // Check if it's a multi-day range
        if (firstDate.toDateString() !== lastDate.toDateString()) {
            dateStr = `${firstDate.toLocaleDateString()} - ${lastDate.toLocaleDateString()}`;
        } else {
            dateStr = firstDate.toLocaleDateString();
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
        } else {
            dateStr = startDate.toLocaleDateString();
        }
        
        const startTime = startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const endTime = endDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        timeStr = `${startTime} - ${endTime}`;
    }
    
    return {
        id: job.Id,
        title: job.WorkerTitle,
        employee: `${job.WorkerFirstName} ${job.WorkerLastName}`.trim(),
        school: job.Items && job.Items[0] ? job.Items[0].Institution.Name : 'See details in Aesop',
        date: dateStr,
        time: timeStr,
        duration: job.Items && job.Items[0] ? job.Items[0].Duration.substring(0, 5) : 'N/A',
        foundAt: new Date().toISOString()
    };
}

// Extract jobs directly from live page (always fresh data)
        console.log('Extracting jobs from live page...');
        
        let shifts = [];
        
        try {
            // Always scrape live page for fresh data
            if (page && !page.isClosed()) {
                console.log(' SCRAPING LIVE PAGE for current job data...');
                const livePageContent = await page.content();
                
                // Parse the live page content
                const livePageVarsMatch = livePageContent.match(/var pageVars = ({[\s\S]*?});/);
                if (livePageVarsMatch) {
                    const pageVarsText = livePageVarsMatch[0].replace(/^var pageVars = /, '').replace(/;$/, '');
                    const pageVars = new Function(`return ${pageVarsText}`)();
                    
                    if (pageVars && pageVars.availJobs && pageVars.availJobs.list) {
                        console.log(` LIVE DATA: Found ${pageVars.availJobs.list.length} jobs from live page`);
                        
                        for (const job of pageVars.availJobs.list) {
                            // Use the helper function to extract job data
                            const jobData = extractJobData(job);
                            if (jobData) {
                                console.log(` ADDING JOB: ${job.WorkerTitle} at ${jobData.school}`);
                                shifts.push(jobData);
                            }
                        }
                    } else {
                        console.log('No availJobs.list found in live pageVars');
                    }
                } else {
                    console.log('No pageVars object found in live page');
                }
            } else {
                console.error(' Cannot scrape live page - page is closed or not available');
            }
            
        } catch (liveError) {
            console.error('Error scraping live page:', liveError);
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
        console.log(`🔍 NOTIFIED SHIFT IDs: ${Array.from(notifiedShiftIds).join(', ')}`);
        console.log(`🔍 ALL SHIFT IDs: ${filteredShifts.map(s => s.id).join(', ')}`);
        console.log(`🔍 NEW SHIFT IDS: ${newShifts.map(s => s.id).join(', ')}`);
        
        if (newShifts.length > 0) {
            console.log('📋 NEW SHIFTS DETAILS:');
            newShifts.forEach((shift, index) => {
                console.log(`  ${index + 1}. ID ${shift.id} - ${shift.title} at ${shift.school} (${shift.date})`);
            });
        }

        if (newShifts.length > 0) {
            console.log('New shifts found:', newShifts);
            
            // Add new shifts to the notified set
            newShifts.forEach(shift => notifiedShiftIds.add(shift.id));
            
            // Update available shifts for dashboard
            availableShifts = [...filteredShifts];
            lastChecked = new Date();
            
            // Send email notification
            console.log(`📧 SENDING EMAIL at ${new Date().toISOString()} for ${newShifts.length} new job${newShifts.length > 1 ? 's' : ''}`);
            const emailStartTime = Date.now();
            await sendEmailNotification(newShifts);
            const emailEndTime = Date.now();
            console.log(`📧 EMAIL SENT at ${new Date().toISOString()} (${emailEndTime - emailStartTime}ms)`);
            
            // AUTO-ACCEPT: Check for jobs that meet auto-accept criteria
            if (CONFIG.autoAcceptEnabled) {
                const autoAcceptCandidates = newShifts.filter(shift => {
                    // 🏫 SCHOOL FILTER: Check if school is in allowed list
                    const schoolName = shift.school ? shift.school.trim().toUpperCase() : '';
                    
                    // Fix TypeError: Ensure CONFIG.autoAcceptSchools is defined
                    if (!CONFIG.autoAcceptSchools || !Array.isArray(CONFIG.autoAcceptSchools)) {
                        console.log('❌ AUTO-ACCEPT: CONFIG.autoAcceptSchools is not defined or not an array');
                        return false;
                    }
                    
                    const allowedSchools = CONFIG.autoAcceptSchools.map(s => s.toUpperCase());
                    
                    console.log(`🏫 SCHOOL FILTER: Checking "${schoolName}" against allowed schools`);
                    console.log(`📋 ALLOWED SCHOOLS: ${allowedSchools.join(', ')}`);
                    
                    if (!allowedSchools.includes(schoolName)) {
                        console.log(`❌ SCHOOL FILTER: REJECTED - "${schoolName}" not in allowed list`);
                        console.log(`💡 This job will NOT be auto-accepted`);
                        return false;
                    }
                    
                    console.log(`✅ SCHOOL FILTER: APPROVED - "${schoolName}" is in allowed list`);
                    
                    // Calculate hours in future - handle date parsing more robustly
                    let shiftDate;
                    try {
                        // Try to parse the actual job date (not foundAt)
                        if (shift.date) {
                            // Handle multi-day date ranges like "3/31/2026 - 3/2/2026"
                            if (shift.date.includes(' - ')) {
                                // Extract the first date from the range
                                const firstDateStr = shift.date.split(' - ')[0];
                                shiftDate = new Date(firstDateStr);
                                console.log(`🔧 AUTO-ACCEPT: Parsed first date from range: ${firstDateStr} -> ${shiftDate.toISOString()}`);
                            } else {
                                // Single date
                                shiftDate = new Date(shift.date);
                                console.log(`🔧 AUTO-ACCEPT: Parsed single date: ${shift.date} -> ${shiftDate.toISOString()}`);
                            }
                        } else if (shift.foundAt) {
                            // Fallback to foundAt (when job was discovered)
                            shiftDate = new Date(shift.foundAt);
                            console.log(`🔧 AUTO-ACCEPT: Using foundAt as fallback: ${shift.foundAt}`);
                        } else {
                            // No date available
                            console.log(`❌ AUTO-ACCEPT: No date available for shift ${shift.id}`);
                            return false;
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
                    autoAcceptCandidates.forEach((candidate, index) => {
                        console.log(`🎯 CANDIDATE ${index + 1}: ID ${candidate.id} - ${candidate.title} at ${candidate.school}`);
                    });
                    
                    // Log auto-accept trigger event
                    console.log(`📧 AUTO-ACCEPT TRIGGERED: Will send notifications for ${autoAcceptCandidates.length} candidates`);
                    console.log(`📧 Notification recipient: kjagpal75@gmail.com`);
                    
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
                            console.log(`🔄 ATTEMPTING AUTO-ACCEPT: Shift ${shift.id}`);
                            const result = await acceptJobWithSession(shift.id, originalBrowser, originalPage);
                            
                            if (result.success) {
                                console.log(`✅ AUTO-ACCEPT SUCCESS: ${result.message}`);
                                await sendAutoAcceptNotification(shift, 'SUCCESS', result.message);
                            } else {
                                console.log(`❌ AUTO-ACCEPT FAILED: ${result.message}`);
                                await sendAutoAcceptNotification(shift, 'FAILED', result.message);
                            }
                        } catch (error) {
                            console.error(`💥 AUTO-ACCEPT ERROR: Shift ${shift.id} - ${error.message}`);
                            await sendAutoAcceptNotification(shift, 'ERROR', error.message);
                        }
                    }
                    
                    // 🔄 RESTORE BROWSER VARIABLES AFTER AUTO-ACCEPT
                    browser = originalBrowser;
                    page = originalPage;
                }
            }
        } else {
            console.log('No new shifts found');
        }
        
        // IMPORTANT: Always update availableShifts with current available jobs
        // This prevents showing stale jobs that are no longer available
        console.log(`🔄 UPDATING DASHBOARD: Old jobs: ${availableShifts.length}, New jobs: ${filteredShifts.length}`);
        console.log(`🗑️ CLEARING old job data: ${availableShifts.map(s => `${s.id}-${s.school}`).join(', ')}`);
        
        // Force clear the array first
        availableShifts.length = 0;
        availableShifts = [...filteredShifts];
        lastChecked = new Date();
        
        console.log(`📊 DASHBOARD UPDATE: ${filteredShifts.length} current available jobs`);
        console.log(`📋 AVAILABLE JOB IDS: ${filteredShifts.map(s => s.id).join(', ')}`);
        console.log(`🏫 SCHOOLS: ${filteredShifts.map(s => s.school).join(', ')}`);
        
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

    // Email configuration is tested on startup - no need to test before each send
    // This removes 5-10 second delay from each email notification

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
                <a href="${CONFIG.publicUrl}/api/accept-job/${shift.id}" style="background-color: #28a745; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-right: 10px;">✅ Accept Job</a>
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
        console.log('✅ Email notification sent successfully!');
    } catch (error) {
        console.error('❌ EMAIL SEND FAILED:', error.message);
        console.error('❌ Full error details:', error);
        // Don't throw error - continue with auto-accept even if email fails
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

// Send auto-accept notification to kjagpal75@gmail.com
async function sendAutoAcceptNotification(shift, status, message) {
    console.log(`📧 Sending auto-accept notification: ${shift.id} - ${status}`);
    
    if (!transporter) {
        console.log('Email transporter not configured, skipping auto-accept notification');
        return;
    }

    const statusEmoji = status === 'SUCCESS' ? '✅' : status === 'FAILED' ? '❌' : '💥';
    const statusColor = status === 'SUCCESS' ? '#28a745' : status === 'FAILED' ? '#dc3545' : '#fd7e14';
    
    const mailOptions = {
        from: CONFIG.emailFrom,
        to: 'kjagpal75@gmail.com',  // Send specifically to kjagpal75@gmail.com
        subject: `🤖 Auto-Accept ${status}: ${shift.title} at ${shift.school}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: ${statusColor}; color: white; padding: 20px; text-align: center;">
                    <h1>${statusEmoji} Auto-Accept ${status}</h1>
                    <p style="font-size: 18px; margin: 10px 0;">Aesop Shift Checker</p>
                </div>
                
                <div style="padding: 20px; background: #f8f9fa;">
                    <h2>Job Details:</h2>
                    <ul style="list-style: none; padding: 0;">
                        <li><strong>Job ID:</strong> ${shift.id}</li>
                        <li><strong>Position:</strong> ${shift.title}</li>
                        <li><strong>School:</strong> ${shift.school}</li>
                        <li><strong>Date:</strong> ${shift.date}</li>
                        <li><strong>Time:</strong> ${shift.time}</li>
                        <li><strong>Duration:</strong> ${shift.duration}</li>
                        <li><strong>Employee:</strong> ${shift.employee}</li>
                    </ul>
                </div>
                
                <div style="padding: 20px; background: white;">
                    <h2>Auto-Accept Result:</h2>
                    <div style="background: ${statusColor}20; border-left: 4px solid ${statusColor}; padding: 15px; margin: 10px 0;">
                        <p style="margin: 0; font-weight: bold;">${statusEmoji} ${status}</p>
                        <p style="margin: 5px 0; color: #666;">${message}</p>
                    </div>
                </div>
                
                <div style="padding: 20px; background: #e9ecef;">
                    <h3>Timestamp Information:</h3>
                    <ul style="list-style: none; padding: 0;">
                        <li><strong>Auto-Accept Attempt:</strong> ${new Date().toLocaleString()}</li>
                        <li><strong>Job Found:</strong> ${new Date(shift.foundAt).toLocaleString()}</li>
                        <li><strong>Hours in Future:</strong> ${((new Date(shift.date) - new Date()) / (1000 * 60 * 60)).toFixed(2)} hours</li>
                    </ul>
                </div>
                
                <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
                    <p>Aesop Shift Checker - Auto-Accept Monitoring</p>
                    <p>Server Time: ${new Date().toLocaleString()}</p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Auto-accept notification sent successfully: ${status}`);
    } catch (emailError) {
        console.error('❌ Error sending auto-accept notification:', emailError);
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

// Global error handler for EIO and other errors
process.on('uncaughtException', (error) => {
    if (error.code === 'EIO') {
        console.error('EIO Error caught and handled - logging issue detected');
        return; // Don't crash the process
    }
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.code === 'EIO') {
        console.error('EIO Error in promise caught and handled - logging issue detected');
        return; // Don't crash the process
    }
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the Express server
const PORT = 3000;
app.listen(PORT, async () => {
    console.log(`Dashboard available at ${CONFIG.publicUrl}`);
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
