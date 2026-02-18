// Enhanced auto-accept with retry logic and browser session management
                        console.log(`🚀 AUTO-ACCEPTING: Shift ${shift.id} - ${shift.position} at ${shift.school}`);
                        
                        // Enhanced retry logic for auto-accept
                        const maxRetries = 3;
                        const retryDelay = 3000; // 3 seconds
                        
                        async function acceptJobWithRetry(jobId, retryCount = 0) {
                            console.log(`🎯 Auto-accept attempt ${retryCount + 1}/${maxRetries} for job ${jobId}`);
                            
                            try {
                                // Use the existing browser session from job checking
                                if (browser && page && !page.isClosed() && browser.isConnected()) {
                                    console.log('🔄 Using existing browser session for auto-accept');
                                    
                                    // Check if we're still logged in
                                    const currentUrl = page.url();
                                    if (currentUrl.includes('frontlineeducation.com') && !currentUrl.includes('login')) {
                                        console.log('✅ Using existing logged-in session for auto-accept');
                                        
                                        // Navigate to Available Jobs page to ensure we're in the right context
                                        console.log('Navigating to Available Jobs for auto-accept...');
                                        await page.goto('https://absencesub.frontlineeducation.com/Substitute/Schedule/AvailableJobs', {
                                            waitUntil: 'networkidle2',
                                            timeout: 30000
                                        });
                                        
                                        // Wait a moment for the page to load
                                        await new Promise(resolve => setTimeout(resolve, 2000));
                                        
                                        // Now attempt to accept the job using the existing session
                                        const acceptResult = await page.evaluate((targetJobId) => {
                                            const acceptButton = document.querySelector(`button[data-job-id="${targetJobId}"], button[onclick*="${targetJobId}"], .accept-job-btn[data-job-id="${targetJobId}"]`);
                                            if (acceptButton) {
                                                acceptButton.click();
                                                return { success: true, message: 'Accept button clicked' };
                                            }
                                            return { success: false, message: 'Accept button not found' };
                                        }, jobId);
                                        
                                        if (!acceptResult.success) {
                                            throw new Error(acceptResult.message);
                                        }
                                        
                                        // Wait for confirmation
                                        await new Promise(resolve => setTimeout(resolve, 3000));
                                        
                                        // Check for confirmation message
                                        const confirmation = await page.evaluate(() => {
                                            const confirmationElement = document.querySelector('.success-message, .confirmation-message, .alert-success, [data-testid="accept-confirmation"]');
                                            if (confirmationElement) {
                                                return confirmationElement.textContent.trim();
                                            }
                                            return null;
                                        });
                                        
                                        if (confirmation) {
                                            console.log(`✅ Auto-accept SUCCESS: Job ${jobId} accepted! Confirmation: ${confirmation}`);
                                            return { success: true, jobId: jobId, message: confirmation };
                                        } else {
                                            console.log(`✅ Auto-accept SUCCESS: Job ${jobId} likely accepted (no explicit confirmation)`);
                                            return { success: true, jobId: jobId, message: 'Job accepted (no explicit confirmation)' };
                                        }
                                        
                                    } else {
                                        throw new Error('Session expired - not logged in');
                                    }
                                } else {
                                    throw new Error('Browser session not available');
                                }
                                
                            } catch (error) {
                                console.log(`❌ Auto-accept attempt ${retryCount + 1} failed: ${error.message}`);
                                
                                // Check if this is a retryable error
                                const retryableErrors = [
                                    'Target closed',
                                    'Protocol error',
                                    'Connection lost',
                                    'Browser disconnected',
                                    'Session closed',
                                    'Navigation timeout',
                                    'Accept button not found',
                                    'Session expired'
                                ];
                                
                                const isRetryable = retryableErrors.some(retryError => 
                                    error.message.includes(retryError)
                                );
                                
                                if (isRetryable && retryCount < maxRetries) {
                                    console.log(`🔄 Retryable error detected, retrying in ${retryDelay/1000} seconds...`);
                                    
                                    // Clean up any existing browser session
                                    if (browser && browser.isConnected()) {
                                        try {
                                            await browser.close();
                                        } catch (closeError) {
                                            console.log('Error closing browser during retry cleanup:', closeError.message);
                                        }
                                        browser = null;
                                        page = null;
                                    }
                                    
                                    // Wait before retry
                                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                                    
                                    // Retry the auto-accept
                                    return await acceptJobWithRetry(jobId, retryCount + 1);
                                } else {
                                    console.log(`❌ Final auto-accept failure for job ${jobId}: ${error.message}`);
                                    return { success: false, jobId: jobId, message: error.message };
                                }
                            }
                        }
                        
                        // Start the enhanced auto-accept process
                        acceptJobWithRetry(shift.id)
