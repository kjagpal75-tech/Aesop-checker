#!/usr/bin/env node

// Test script for job acceptance functionality
const puppeteer = require('puppeteer');
const CONFIG = require('./config');

async function testJobAcceptance() {
    console.log('🧪 Testing job acceptance functionality...');
    
    let browser = null;
    let page = null;
    
    try {
        // Launch browser with increased timeout and memory optimization
        console.log('🚀 Launching browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-extensions',
                '--disable-plugins',
                '--disable-default-apps',
                '--no-first-run',
                '--no-default-browser-check'
            ],
            protocolTimeout: 120000 // 2 minutes
        });
        
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        // Test login
        console.log('🔐 Testing login...');
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
        
        console.log('📤 Submitting login...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            page.click('#qa-button-login')
        ]);
        
        console.log('✅ Login successful!');
        console.log('📍 Current URL:', page.url());
        
        // Test navigation to available jobs
        console.log('🔍 Navigating to available jobs...');
        await page.goto('https://absencesub.frontlineeducation.com/Substitute/Schedule/AvailableJobs', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        console.log('📍 Available jobs URL:', page.url());
        
        // Check if there are any jobs
        const pageContent = await page.content();
        console.log('📄 Page content length:', pageContent.length);
        
        // Look for job listings
        const hasJobs = await page.evaluate(() => {
            const jobElements = document.querySelectorAll('[data-job-id], .job-row, .available-job');
            return jobElements.length > 0;
        });
        
        console.log('💼 Jobs found:', hasJobs);
        
        if (hasJobs) {
            // Extract job details
            const jobs = await page.evaluate(() => {
                const jobElements = document.querySelectorAll('[data-job-id], .job-row, .available-job');
                return Array.from(jobElements).map(el => ({
                    id: el.getAttribute('data-job-id') || 'unknown',
                    title: el.querySelector('.job-title, .position')?.textContent || 'unknown',
                    school: el.querySelector('.school-name, .location')?.textContent || 'unknown'
                }));
            });
            
            console.log('📋 Available jobs:', jobs);
            
            if (jobs.length > 0) {
                console.log('🎯 Testing job acceptance with first job...');
                // Note: We won't actually accept the job, just test the flow
                console.log('⚠️  Skipping actual job acceptance to avoid accepting real jobs');
            }
        } else {
            console.log('ℹ️  No jobs available for testing');
        }
        
        // Test screenshot with error handling
        console.log('📸 Testing screenshot...');
        try {
            await page.screenshot({ path: 'test-job-page.png', fullPage: true });
            console.log('✅ Screenshot saved');
        } catch (screenshotError) {
            console.warn('⚠️  Screenshot failed:', screenshotError.message);
        }
        
        console.log('✅ Test completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        // Cleanup
        if (page) {
            try {
                await page.close();
            } catch (e) {
                console.warn('Error closing page:', e.message);
            }
        }
        
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                console.warn('Error closing browser:', e.message);
            }
        }
        
        console.log('🧹 Cleanup completed');
    }
}

// Run the test
testJobAcceptance().catch(console.error);
