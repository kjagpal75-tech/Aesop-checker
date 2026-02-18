// Simple test to add job 752919851 for auto-accept testing
// This will be inserted after "Found 0 potential shifts"

console.log('🎯 TEST: Creating test job 752919851 for auto-accept testing');
const testShift = {
    id: '752919851',
    position: 'PE',
    school: 'THORNTON MIDDLE SCHOOL',
    date: new Date().toLocaleDateString(),
    startDate: new Date(),
    endDate: new Date(),
    hoursInFuture: 48,
    details: {
        Id: '752919851',
        WorkerTitle: 'PE',
        OrganizationName: 'THORNTON MIDDLE SCHOOL',
        SubstituteId: null
    }
};
shifts.push(testShift);
console.log('🎯 TEST SHIFT ADDED: Job 752919851 (PE at THORNTON MIDDLE SCHOOL)');
