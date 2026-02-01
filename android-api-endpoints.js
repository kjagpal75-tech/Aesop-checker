// Add these endpoints to your existing aesop-checker.js

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

// Also add this to your existing email notification function to also send push notifications
// Modify the sendEmailNotification function to include push notifications:
