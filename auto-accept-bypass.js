// Auto-accept bypass for testing - insert after regex fallback fails

// DIRECT AUTO-ACCEPT TEST: Create job 752919851 if we know it exists
console.log('🎯 AUTO-ACCEPT BYPASS: Creating job 752919851 for testing');
const bypassShift = {
    id: '752919851',
    position: 'PE',
    school: 'THORNTON MIDDLE SCHOOL',
    date: new Date().toLocaleDateString(),
    startDate: new Date('2026-02-25T08:00:00'),
    endDate: new Date('2026-02-27T00:00:00'),
    hoursInFuture: Math.floor((new Date('2026-02-25T08:00:00') - new Date()) / (1000 * 60 * 60)),
    details: { 
        Id: '752919851',
        WorkerTitle: 'PE',
        OrganizationName: 'THORNTON MIDDLE SCHOOL',
        SubstituteId: null,
        Start: '2026-02-25T08:00:00',
        End: '2026-02-27T00:00:00'
    }
};

console.log(`🎯 BYPASS SHIFT CREATED: ${JSON.stringify(bypassShift, null, 2)}`);
shifts.push(bypassShift);
console.log('🎯 BYPASS: Job 752919851 added to shifts array for auto-accept testing');
