// Enhanced job visibility and auto-accept logic - SYNTAX FIXED

        // Check for new shifts
        const newShifts = filteredShifts.filter(shift => !notifiedShiftIds.has(shift.id));
        
        console.log(`Found ${newShifts.length} new shifts`);
        console.log(`📊 Total available shifts: ${filteredShifts.length}`);
        
        // Track auto-accept attempts to avoid duplicates
        const autoAcceptAttempts = new Set();
        
        if (newShifts.length > 0) {
            console.log('New shifts found:', newShifts);
            // Add new shifts to the notified set
            newShifts.forEach(shift => notifiedShiftIds.add(shift.id));
            
            console.log(`📊 Final shifts array has ${filteredShifts.length} shifts`);
            console.log('📋 filteredShifts preview:', JSON.stringify(filteredShifts.slice(0, 2), null, 2));
            availableShifts = [...filteredShifts];
            lastChecked = new Date();
            
            // Send email notification for new shifts
            await sendEmailNotification(newShifts);
            
            // AUTO-ACCEPT: Check each new shift for auto-accept criteria
            newShifts.forEach(shift => {
                console.log(`🔧 AUTO-ACCEPT DEBUG: Processing shift ${shift.id}`);
                console.log(`📅 Shift Start: ${shift.startDate}`);
                console.log(`🕐 Current Time: ${new Date().toISOString()}`);
                console.log(`⏰ Hours in Future: ${shift.hoursInFuture}`);
                console.log(`🎯 Threshold: ${CONFIG.autoAcceptHoursInFuture} hours`);
                console.log(`🔧 Auto-Accept Enabled: ${CONFIG.autoAcceptEnabled}`);
                
                if (CONFIG.autoAcceptEnabled && shift.hoursInFuture >= CONFIG.autoAcceptHoursInFuture) {
                    console.log(`🎯 AUTO-ACCEPT QUALIFIED: Shift ${shift.id} is ${shift.hoursInFuture} hours in future (>= ${CONFIG.autoAcceptHoursInFuture}h)`);
                    
                    if (CONFIG.autoAcceptLogOnly) {
                        console.log(`📝 LOG ONLY MODE: Would auto-accept shift ${shift.id} - ${shift.position} at ${shift.school}`);
                    } else {
                        console.log(`🚀 AUTO-ACCEPTING: Shift ${shift.id} - ${shift.position} at ${shift.school}`);
                        
                        // Track this auto-accept attempt
                        autoAcceptAttempts.add(shift.id);
                        
                        // Auto-accept the job in the background
                        acceptJob(shift.id)
                            .then(result => {
                                if (result.success) {
                                    console.log(`✅ AUTO-ACCEPT SUCCESS: Shift ${shift.id} accepted automatically!`);
                                    
                                    // Send special auto-accept notification
                                    sendAutoAcceptNotification(shift, shift.hoursInFuture);
                                    
                                    // Send immediate confirmation notification
                                    sendAutoAcceptConfirmation(shift.id, shift, shift.hoursInFuture);
                                } else {
                                    console.log(`❌ AUTO-ACCEPT FAILED: Shift ${shift.id} - ${result.message}`);
                                    
                                    // Send failure notification
                                    sendAutoAcceptFailureNotification(shift.id, shift, result.message);
                                }
                            })
                            .catch(error => {
                                console.log(`💥 AUTO-ACCEPT ERROR: Shift ${shift.id} - ${error.message}`);
                                
                                // Send error notification
                                sendAutoAcceptFailureNotification(shift.id, shift, error.message);
                            });
                    }
                } else {
                    console.log(`❌ AUTO-ACCEPT NOT QUALIFIED: Shift ${shift.id} - ${shift.hoursInFuture} hours (need >= ${CONFIG.autoAcceptHoursInFuture}h) or auto-accept disabled`);
                }
            });
        } else {
            console.log('❌ No new shifts found');
            console.log(`📊 Final shifts array still has ${availableShifts.length} shifts`);
        }
        
        // ENHANCED: Continue to show available jobs on dashboard and send reminders
        if (filteredShifts.length > 0) {
            console.log(`🔄 CONTINUOUS MONITORING: ${filteredShifts.length} available shifts remain visible`);
            // Update available shifts to keep jobs visible on dashboard
            availableShifts = [...filteredShifts];
            lastChecked = new Date();
            
            // Check for jobs that haven't been auto-accepted yet and retry if needed
            const availableForAutoAccept = filteredShifts.filter(shift => 
                CONFIG.autoAcceptEnabled && 
                shift.hoursInFuture >= CONFIG.autoAcceptHoursInFuture &&
                !autoAcceptAttempts.has(shift.id) &&
                shift.details && shift.details.SubstituteId === null // Still available
            );
            
            if (availableForAutoAccept.length > 0) {
                console.log(`🔄 RETRY AUTO-ACCEPT: ${availableForAutoAccept.length} jobs available for retry`);
                availableForAutoAccept.forEach(shift => {
                    console.log(`🔄 RETRY ATTEMPT: Shift ${shift.id} - ${shift.position} at ${shift.school}`);
                    
                    // Track this retry attempt
                    autoAcceptAttempts.add(shift.id);
                    
                    // Retry auto-accept with delay
                    setTimeout(() => {
                        acceptJob(shift.id)
                            .then(result => {
                                if (result.success) {
                                    console.log(`✅ RETRY AUTO-ACCEPT SUCCESS: Shift ${shift.id} accepted!`);
                                    sendAutoAcceptNotification(shift, shift.hoursInFuture);
                                } else {
                                    console.log(`❌ RETRY AUTO-ACCEPT FAILED: Shift ${shift.id} - ${result.message}`);
                                }
                            })
                            .catch(error => {
                                console.log(`💥 RETRY AUTO-ACCEPT ERROR: Shift ${shift.id} - ${error.message}`);
                            });
                    }, Math.random() * 5000 + 2000); // Random delay 2-7 seconds
                });
            }
            
            // Send periodic email reminders for available jobs (every 30 minutes)
            const thirtyMinutesInMs = 30 * 60 * 1000;
            if (!lastEmailNotification || (Date.now() - lastEmailNotification.getTime()) > thirtyMinutesInMs) {
                console.log('📧 SENDING PERIODIC EMAIL REMINDER for available jobs');
                await sendEmailNotification(filteredShifts, 'periodic_reminder');
                lastEmailNotification = new Date();
            }
        }
        
        availableShifts = [...filteredShifts];
        lastChecked = new Date();
    }
