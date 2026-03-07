// Test inverted date range parsing
console.log('=== Testing Inverted Date Range Parsing ===\n');

// Test the current parsing logic
function testDateParsing(dateStr) {
    console.log(`Testing date string: "${dateStr}"`);
    
    if (dateStr.includes(' - ')) {
        // Extract the first date from the range (current logic)
        const firstDateStr = dateStr.split(' - ')[0];
        const shiftDate = new Date(firstDateStr);
        console.log(`  📅 First date extracted: "${firstDateStr}"`);
        console.log(`  🕐 Parsed Date: ${shiftDate.toISOString()}`);
        console.log(`  📋 Formatted: ${shiftDate.toLocaleDateString()}`);
        
        // Check if this is a valid date
        if (isNaN(shiftDate.getTime())) {
            console.log(`  ❌ INVALID DATE`);
        } else {
            console.log(`  ✅ Valid date`);
        }
    } else {
        const shiftDate = new Date(dateStr);
        console.log(`  🕐 Parsed Date: ${shiftDate.toISOString()}`);
        console.log(`  📋 Formatted: ${shiftDate.toLocaleDateString()}`);
    }
    console.log('');
}

// Test cases
testDateParsing('3/11/26 - 3/9/26');  // Inverted range (the problematic one)
testDateParsing('3/9/26 - 3/11/26');  // Normal range
testDateParsing('3/11/2026 - 3/9/2026');  // Full year inverted
testDateParsing('3/9/2026 - 3/11/2026');  // Full year normal
testDateParsing('3/11/26');  // Single date
testDateParsing('3/9/26');   // Single date

// Test how JavaScript Date constructor handles these
console.log('=== JavaScript Date Constructor Tests ===\n');

const testDates = [
    '3/11/26',
    '3/9/26',
    '3/11/2026',
    '3/9/2026'
];

testDates.forEach(dateStr => {
    const date = new Date(dateStr);
    console.log(`"${dateStr}" -> ${date.toISOString()} (${date.toLocaleDateString()})`);
});

console.log('\n=== Analysis ===');
console.log('The issue: "3/11/26 - 3/9/26" shows March 11 to March 9 (inverted)');
console.log('Current logic: Takes first date (3/11/26) which is March 11, 2026');
console.log('This might be correct if the job spans from March 9 to March 11');
console.log('But the display shows "3/11/26 - 3/9/26" which is confusing');
