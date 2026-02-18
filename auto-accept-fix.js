// Auto-accept logic to insert after "New shifts found:"
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
