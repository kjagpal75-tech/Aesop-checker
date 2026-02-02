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

// Function to accept a job
async function acceptJob(jobId) {
    console.log(`Attempting to accept job ${jobId}...`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

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
            await browser.close();
        }
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
            
            // Simple piece-by-piece extraction approach
            console.log('Using simple piece-by-piece extraction...');
            
            // Look for all available jobs by finding SubstituteId: null
            const availableJobSections = afterLoginHtml.split('"SubstituteId":null');
            
            console.log(`Found ${availableJobSections.length - 1} sections with SubstituteId: null`);
            
            for (let i = 1; i < availableJobSections.length; i++) {
                try {
                    const section = availableJobSections[i];
                    const previousSection = availableJobSections[i-1];
                    
                    console.log(`\n--- Processing available job section ${i} ---`);
                    
                    // The ID is in the previous section, so look there
                    const idMatch = previousSection.match(/"Id":(\d+)/);
                    const titleMatch = section.match(/"WorkerTitle":"([^"]+)"/);
                    const firstNameMatch = section.match(/"WorkerFirstName":"([^"]+)"/);
                    const lastNameMatch = section.match(/"WorkerLastName":"([^"]+)"/);
                    const startMatch = previousSection.match(/"Start":"([^"]+)"/);
                    // Look for school and duration in both sections
                    let schoolMatch = section.match(/"Name":"([^"]+)"/);
                    let durationMatch = section.match(/"Duration":"([^"]+)"/);
                    
                    if (!schoolMatch) {
                        schoolMatch = previousSection.match(/"Name":"([^"]+)"/);
                    }
                    if (!durationMatch) {
                        durationMatch = previousSection.match(/"Duration":"([^"]+)"/);
                    }
                    
                    console.log(`ID match: ${!!idMatch}`, idMatch ? idMatch[1] : 'N/A');
                    console.log(`Title match: ${!!titleMatch}`, titleMatch ? titleMatch[1] : 'N/A');
                    console.log(`FirstName match: ${!!firstNameMatch}`, firstNameMatch ? firstNameMatch[1] : 'N/A');
                    console.log(`LastName match: ${!!lastNameMatch}`, lastNameMatch ? lastNameMatch[1] : 'N/A');
                    console.log(`Start match: ${!!startMatch}`, startMatch ? startMatch[1] : 'N/A');
                    console.log(`School match: ${!!schoolMatch}`, schoolMatch ? schoolMatch[1] : 'N/A');
                    console.log(`Duration match: ${!!durationMatch}`, durationMatch ? durationMatch[1] : 'N/A');
                    
                    if (idMatch && titleMatch) {
                        const jobId = idMatch[1];
                        const jobTitle = titleMatch[1];
                        const employeeName = `${firstNameMatch ? firstNameMatch[1] : ''} ${lastNameMatch ? lastNameMatch[1] : ''}`.trim();
                        
                        console.log(`ID: ${jobId}`);
                        console.log(`Title: ${jobTitle}`);
                        console.log(`Employee: ${employeeName}`);
                        console.log(`School: ${schoolMatch ? schoolMatch[1] : 'N/A'}`);
                        console.log(`Duration: ${durationMatch ? durationMatch[1].substring(0, 5) : 'N/A'}`);
                        console.log(`Start: ${startMatch ? startMatch[1] : 'N/A'}`);
                        
                        // Check if this is a position we want to include
                        const isDesiredPosition = jobTitle.toLowerCase().includes('substitute') ||
                                                      jobTitle.toLowerCase().includes('teacher') ||
                                                      jobTitle.toLowerCase().includes('sub') ||
                                                      jobTitle.toLowerCase().includes('physical education') ||
                                                      jobTitle.toLowerCase().includes('pe') ||
                                                      jobTitle.toLowerCase().includes('math') ||
                                                      jobTitle.toLowerCase().includes('science') ||
                                                      jobTitle.toLowerCase().includes('english') ||
                                                      jobTitle.toLowerCase().includes('history') ||
                                                      jobTitle.toLowerCase().includes('art') ||
                                                      jobTitle.toLowerCase().includes('music') ||
                                                      jobTitle.toLowerCase().includes('coach');
                        
                        console.log(`Is desired position: ${isDesiredPosition}`);
                        
                        if (isDesiredPosition) {
                            // Format date and time
                            const startDate = startMatch ? new Date(startMatch[1]) : null;
                            const dateStr = startDate ? startDate.toLocaleDateString() : 'N/A';
                            const timeStr = startDate ? startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'N/A';
                            
                            const shiftData = {
                                id: jobId,
                                title: jobTitle,
                                employee: employeeName,
                                school: schoolMatch ? schoolMatch[1] : 'See details in Aesop',
                                date: dateStr,
                                time: timeStr,
                                duration: durationMatch ? durationMatch[1].substring(0, 5) : 'N/A',
                                foundAt: new Date().toISOString()
                            };
                            
                            console.log(`✅ ADDING JOB: ${jobTitle} at ${shiftData.school}`);
                            shifts.push(shiftData);
                        } else {
                            console.log(`❌ SKIPPING JOB - Not desired position: ${jobTitle}`);
                        }
                    } else {
                        console.log(`Section ${i} missing required fields (ID: ${!!idMatch}, Title: ${!!titleMatch})`);
                    }
                } catch (sectionError) {
                    console.error(`Error processing section ${i}:`, sectionError);
                }
            }
            
            console.log(`\nTotal jobs found: ${shifts.length}`);
            
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
        } else {
            console.log('No new shifts found');
        }

    } catch (error) {
        console.error('Error checking for shifts:', error);
        
        // Send error notification
        await sendErrorNotification(error, "Job Check Failed");
        
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

// API endpoint for Android app to get shifts
app.get('/api/shifts', (req, res) => {
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
