// Test improved date range parsing logic
console.log('=== Testing Improved Date Range Parsing ===\n');

function improvedDateRangeParsing(items) {
    if (!items || items.length === 0) {
        return { dateStr: 'N/A', timeStr: 'N/A' };
    }
    
    // Sort items by Start date to ensure correct order
    const sortedItems = [...items].sort((a, b) => 
        new Date(a.Start) - new Date(b.Start)
    );
    
    const firstShift = sortedItems[0];  // Earliest date
    const lastShift = sortedItems[sortedItems.length - 1];  // Latest date
    
    const firstDate = new Date(firstShift.Start);
    const lastDate = new Date(lastShift.Start);
    
    let dateStr, timeStr;
    
    // Check if it's a multi-day range
    if (firstDate.toDateString() !== lastDate.toDateString()) {
        dateStr = `${firstDate.toLocaleDateString()} - ${lastDate.toLocaleDateString()}`;
        console.log(`📅 Multi-day range: ${dateStr}`);
    } else {
        // Single day
        dateStr = firstDate.toLocaleDateString();
        console.log(`📅 Single day: ${dateStr}`);
    }
    
    // Get time range from first to last
    const firstTime = new Date(firstShift.Start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const lastTime = new Date(lastShift.End).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    timeStr = `${firstTime} - ${lastTime}`;
    
    console.log(`🕐 Time range: ${timeStr}`);
    console.log(`📋 Original items order: ${items.map(i => new Date(i.Start).toLocaleDateString()).join(', ')}`);
    console.log(`📋 Sorted items order: ${sortedItems.map(i => new Date(i.Start).toLocaleDateString()).join(', ')}`);
    console.log('');
    
    return { dateStr, timeStr };
}

// Test with inverted date items (simulating the problematic case)
console.log('Test 1: Inverted Items Array (Current Problem)');
const invertedItems = [
    {
        Start: '2026-03-11T08:00:00',
        End: '2026-03-11T15:00:00'
    },
    {
        Start: '2026-03-09T08:00:00', 
        End: '2026-03-09T15:00:00'
    }
];

const result1 = improvedDateRangeParsing(invertedItems);

console.log('Test 2: Normal Items Array');
const normalItems = [
    {
        Start: '2026-03-09T08:00:00',
        End: '2026-03-09T15:00:00'
    },
    {
        Start: '2026-03-11T08:00:00',
        End: '2026-03-11T15:00:00'
    }
];

const result2 = improvedDateRangeParsing(normalItems);

console.log('Test 3: Single Day');
const singleDayItems = [
    {
        Start: '2026-03-10T08:00:00',
        End: '2026-03-10T15:00:00'
    }
];

const result3 = improvedDateRangeParsing(singleDayItems);

console.log('=== Summary ===');
console.log('Current logic uses items[items.length - 1] for first day and items[0] for last day');
console.log('This assumes Items array is sorted in reverse chronological order');
console.log('Improved logic sorts items by Start date to ensure correct chronological order');
console.log('This will fix inverted date ranges like "3/11/26 - 3/9/26"');
