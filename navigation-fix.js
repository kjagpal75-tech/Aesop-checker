// Comprehensive fix for intermittent navigation issues

// 1. Enhanced browser launch arguments for better stability
const enhancedBrowserArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-component-extensions-with-background-pages',
    '--disable-crash-reporter',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-search-engine-choice-screen',
    '--disable-client-side-phishing-detection',
    '--disable-hang-monitor',
    '--disable-renderer-backgrounding',
    '--enable-automation',
    '--user-data-dir=/tmp/puppeteer_user_data',
    '--remote-debugging-port=0',
    '--no-zygote-sandbox',
    '--headless=new',
    '--window-size=800,600',
    '--use-angle=swiftshader-webgl',
    '--single-process' // Prevent multiple Chrome instances
];

// 2. Enhanced page navigation with retry logic
async function navigateWithRetry(page, url, maxRetries = 3, retryDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🎯 Navigation attempt ${attempt}/${maxRetries} to ${url}`);
            
            // Clear cache to ensure fresh load
            await page.evaluate(() => {
                window.location.reload();
            });
            
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 60000 // 60 seconds
            });
            
            // Wait for page to be fully interactive
            await page.evaluate(() => {
                return document.readyState === 'complete';
            });
            
            console.log('✅ Navigation successful');
            return true;
            
        } catch (error) {
            console.log(`❌ Navigation attempt ${attempt}/${maxRetries} failed: ${error.message}`);
            
            if (attempt < maxRetries) {
                console.log(`🔄 Retrying in ${retryDelay/1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                
                // Clear browser cache and retry
                await page.evaluate(() => {
                    if (window.location.href !== url) {
                        window.location.href = url;
                    }
                });
            } else {
                    throw error;
                }
            }
        }
    }
}

// 3. Connection health check
async function checkConnectionHealth(page) {
    try {
        const response = await page.evaluate(() => {
            return {
                readyState: document.readyState,
                url: window.location.href,
                title: document.title,
                online: navigator.onLine
            };
        });
        return response.online && response.readyState === 'complete';
    } catch (error) {
        return false;
    }
}

// 4. Chrome process cleanup before navigation
async function cleanupChromeProcesses() {
    try {
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);
        
        // Kill orphaned Chrome processes
        const { stdout } = await execPromise('pkill -f chrome');
        
        if (stdout.length > 0) {
            console.log(`🧹 Cleaned up ${stdout.split('\n').filter(line => line.trim()).length} orphaned Chrome processes`);
        }
        
        // Kill any remaining Chrome processes
        const { stdout: chromeProcesses } = await execPromise('ps aux | grep chrome | grep -v grep | awk \'{print $2}');
        
        for (const pid of chromeProcesses) {
            try {
                await execPromise(`kill -9 ${pid}`);
            } catch (error) {
                // Process may have already ended
            }
        }
        
        console.log('🧹 Chrome processes cleaned up');
        
    } catch (error) {
        console.log('Error cleaning Chrome processes:', error.message);
    }
}

// 5. Resource monitoring
function checkSystemResources() {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    return execPromise('free -h').then(stdout => {
        const lines = stdout.split('\n');
        const memLine = lines.find(line => line.includes('Mem:'));
        if (memLine) {
            const memInfo = memLine.trim().split(/\s+/);
            return {
                total: memInfo[1],
                used: memInfo[2],
                free: memInfo[3],
                available: memInfo[4]
            };
        }
        return { total: 0, used: 0, free: 0 };
    });
}

// 6. Network connectivity test
async function testNetworkConnectivity() {
    try {
        const https = require('https');
        const response = await https.get('https://absencesub.frontlineeducation.com', { timeout: 10000 });
        return response.statusCode === 200;
    } catch (error) {
        console.log('Network connectivity issue:', error.message);
        return false;
    }
}
