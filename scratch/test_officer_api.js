import assert from 'assert';

const BASE_URL = 'http://localhost:3001';

async function testTeamLocations() {
  console.log('Testing GET /api/team-locations...');
  const res = await fetch(`${BASE_URL}/api/team-locations`);
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  assert.ok(data.members, 'Expected data to contain members array');
  assert.ok(Array.isArray(data.members), 'Expected members to be an array');
  console.log(`✓ GET /api/team-locations passed. Found ${data.members.length} members.`);
}

async function testWarnings() {
  console.log('Testing GET /api/warnings...');
  const res = await fetch(`${BASE_URL}/api/warnings?province=เชียงราย`);
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  assert.ok(data.Warning, 'Expected data to contain Warning key');
  console.log(`✓ GET /api/warnings passed. Found ${data.Warning.length} warnings.`);
}

async function testWaterLevels() {
  console.log('Testing GET /api/water-levels...');
  const res = await fetch(`${BASE_URL}/api/water-levels?province=เชียงราย`);
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  assert.ok(Array.isArray(data), 'Expected water levels to be an array');
  console.log(`✓ GET /api/water-levels passed. Found ${data.length} stations.`);
}

async function testAiBriefing() {
  console.log('Testing GET /api/ai/briefing...');
  const res = await fetch(`${BASE_URL}/api/ai/briefing?province=เชียงราย`);
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  // briefing might be null if Typhoon AI is offline or key is missing, which is a valid fallback state
  assert.ok('briefing' in data, 'Expected data to contain briefing key');
  console.log(`✓ GET /api/ai/briefing passed. Status: ${data.typhoonStatus || 'unknown'}`);
}

async function testFieldReport() {
  console.log('Testing POST /api/field-report...');
  const payload = {
    type: 'flood',
    severity: 'high',
    note: 'Test report from automated test runner',
    lat: 19.9,
    lon: 99.8,
    province: 'เชียงราย',
    timestamp: new Date().toISOString()
  };
  const res = await fetch(`${BASE_URL}/api/field-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  assert.strictEqual(data.status, 'ok', `Expected status to be ok, got ${data.status}`);
  assert.ok(data.id, 'Expected report ID in response');
  console.log('✓ POST /api/field-report passed.');
}

async function testOverride() {
  console.log('Testing POST /api/override...');
  const payload = {
    route: 'route_a',
    reason: '[Test] ยืนยันใช้เส้นทาง route_a',
    officer: 'แอดมิน'
  };
  const res = await fetch(`${BASE_URL}/api/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  assert.strictEqual(data.success, true, `Expected success to be true, got ${data.success}`);
  console.log('✓ POST /api/override passed.');
}

async function runAll() {
  try {
    await testTeamLocations();
    await testWarnings();
    await testWaterLevels();
    await testAiBriefing();
    await testFieldReport();
    await testOverride();
    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  }
}

runAll();
