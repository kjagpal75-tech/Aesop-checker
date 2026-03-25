#!/usr/bin/env node

// Simple test for job acceptance API
const https = require('https');
const http = require('http');

// Test job acceptance with existing job
const testJobId = '761138336'; // Job ID from logs

function makeRequest(url, options, data = null) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.request(url, {
            ...options,
            rejectUnauthorized: false // Ignore self-signed certificate
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: body
                });
            });
        });
        
        req.on('error', reject);
        
        if (data) {
            req.write(data);
        }
        req.end();
    });
}

async function testJobAcceptance() {
    console.log('🧪 Testing job acceptance API...');
    
    try {
        // First, login to get session
        console.log('🔐 Logging in...');
        const loginResponse = await makeRequest('https://34.71.197.190/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, JSON.stringify({
            username: 'admin',
            password: 'Aesop@2026!'
        }));
        
        console.log('Login status:', loginResponse.statusCode);
        console.log('Login response:', loginResponse.body);
        
        // Extract session cookie
        const setCookieHeader = loginResponse.headers['set-cookie'];
        if (!setCookieHeader) {
            throw new Error('No session cookie received');
        }
        
        const sessionCookie = setCookieHeader.find(cookie => cookie.startsWith('aesop_session='));
        if (!sessionCookie) {
            throw new Error('No aesop_session cookie found');
        }
        
        console.log('✅ Login successful, got session cookie');
        
        // Get current shifts
        console.log('📋 Getting current shifts...');
        const shiftsResponse = await makeRequest('https://34.71.197.190/api/shifts', {
            method: 'GET',
            headers: {
                'Cookie': sessionCookie
            }
        });
        
        console.log('Shifts status:', shiftsResponse.statusCode);
        console.log('Shifts response:', shiftsResponse.body);
        
        // Test job acceptance
        console.log(`🎯 Testing job acceptance for job ${testJobId}...`);
        const acceptResponse = await makeRequest(`https://34.71.197.190/api/accept-job/${testJobId}`, {
            method: 'GET',
            headers: {
                'Cookie': sessionCookie
            }
        });
        
        console.log('Accept status:', acceptResponse.statusCode);
        console.log('Accept response:', acceptResponse.body);
        
        if (acceptResponse.statusCode === 200) {
            console.log('✅ Job acceptance API responded successfully');
        } else {
            console.log('⚠️ Job acceptance returned non-200 status');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run the test
testJobAcceptance();
