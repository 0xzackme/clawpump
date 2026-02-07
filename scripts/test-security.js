/**
 * Security + Consistency Test Suite for ClawDotPump
 * Tests: API key hashing, data privacy, concurrent safety, fee split, input sanitization
 */

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
let savedApiKey = '';

function ok(cond, msg) {
    if (cond) { pass++; console.log(`  ✅ ${msg}`); }
    else { fail++; console.log(`  ❌ FAIL: ${msg}`); }
}

async function fetchJSON(path, opts = {}) {
    const url = `${BASE}${path}`;
    const r = await fetch(url, opts);
    const d = await r.json();
    return { status: r.status, data: d };
}

async function test1_registration() {
    console.log('\n🔐 1. REGISTRATION + API KEY SECURITY');

    // Register agent
    const { status, data } = await fetchJSON('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agentId: 'sec-test',
            agentName: 'Security <script>alert(1)</script> Agent',
            walletAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        }),
    });
    ok(status === 201, `Registration returns 201 (got ${status})`);
    ok(data.apiKey && data.apiKey.startsWith('cpump_'), `API key returned in POST response`);
    ok(data.agent && !data.agent.apiKey, `Agent object does NOT contain apiKey`);
    ok(!JSON.stringify(data.agent).includes('apiKeyHash'), `Agent object does NOT contain apiKeyHash`);
    ok(!data.agent.agentName.includes('<script>'), `HTML stripped from agentName`);
    savedApiKey = data.apiKey;
    console.log(`  📝 API key saved for later tests`);

    // Check GET does NOT return key
    const { data: getData } = await fetchJSON('/api/register?agentId=sec-test');
    ok(!JSON.stringify(getData).includes('cpump_'), `GET response does NOT contain API key`);
    ok(!JSON.stringify(getData).includes('apiKeyHash'), `GET response does NOT contain apiKeyHash`);
    ok(!JSON.stringify(getData).includes('walletAddress'), `GET response does NOT contain walletAddress`);
}

async function test2_launchAuth() {
    console.log('\n🔐 2. LAUNCH AUTHENTICATION');

    // No auth
    const { status: s1 } = await fetchJSON('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', symbol: 'T', description: 'test token this is a longer desc for testing' }),
    });
    ok(s1 === 401, `No auth → 401 (got ${s1})`);

    // Wrong key
    const { status: s2 } = await fetchJSON('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'cpump_wrongkey' },
        body: JSON.stringify({ name: 'Test', symbol: 'TST', description: 'test token this is a longer desc for testing' }),
    });
    ok(s2 === 401, `Wrong API key → 401 (got ${s2})`);

    // Correct key
    const { status: s3, data: d3 } = await fetchJSON('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': savedApiKey },
        body: JSON.stringify({
            name: 'Secure Token',
            symbol: 'SECT',
            description: 'A secure token launched with proper authentication via hashed API key',
        }),
    });
    ok(s3 === 201, `Valid API key → 201 (got ${s3})`);
    ok(d3.feeSplit, `Response includes feeSplit`);
    ok(!JSON.stringify(d3).includes('apiKey'), `Launch response does NOT contain apiKey`);
    ok(!JSON.stringify(d3).includes('simulated'), `Launch response does NOT expose simulated flag`);
    if (d3.feeSplit) {
        ok(d3.feeSplit.creator === '65%', `Creator share is 65% (got ${d3.feeSplit.creator})`);
        ok(d3.feeSplit.platform === '35%', `Platform share is 35% (got ${d3.feeSplit.platform})`);
    }
}

async function test3_dataPrivacy() {
    console.log('\n🔐 3. DATA PRIVACY — ENDPOINT RESPONSES');

    // /api/tokens should not expose internal fields
    const { data: tokensData } = await fetchJSON('/api/tokens');
    const tokenList = JSON.stringify(tokensData);
    ok(!tokenList.includes('apiKey'), `Tokens list does NOT contain apiKey`);
    ok(!tokenList.includes('apiKeyHash'), `Tokens list does NOT contain apiKeyHash`);
    ok(!tokenList.includes('burnTxSig'), `Tokens list does NOT contain burnTxSig`);
    ok(!tokenList.includes('"id"'), `Tokens list does NOT contain internal id`);
    ok(!tokenList.includes('walletAddress'), `Tokens list does NOT contain walletAddress`);
    if (tokensData.tokens?.[0]) {
        ok(tokensData.tokens[0].creatorSharePct !== undefined, `Tokens show creatorSharePct`);
    }

    // Leaderboard
    const { data: lbData } = await fetchJSON('/api/leaderboard');
    const lbStr = JSON.stringify(lbData);
    ok(!lbStr.includes('apiKey'), `Leaderboard does NOT contain apiKey`);
    ok(!lbStr.includes('walletAddress'), `Leaderboard does NOT contain walletAddress`);
    ok(!lbStr.includes('totalVolume'), `Leaderboard does NOT contain totalVolume`);

    // Earnings without auth → limited data
    const { data: pubEarn } = await fetchJSON('/api/earnings?agentId=sec-test');
    ok(pubEarn.success, `Public earnings returns success`);
    ok(!pubEarn.tokenBreakdown, `Public earnings does NOT contain tokenBreakdown`);

    // Earnings with auth → full data
    const { data: authEarn } = await fetchJSON('/api/earnings?agentId=sec-test', {
        headers: { 'X-API-Key': savedApiKey },
    });
    ok(authEarn.tokenBreakdown, `Authenticated earnings DOES contain tokenBreakdown`);
    ok(authEarn.feeSplit, `Authenticated earnings contains feeSplit`);
}

async function test4_inputSanitization() {
    console.log('\n🔐 4. INPUT SANITIZATION');

    // XSS in name
    const { data: d1 } = await fetchJSON('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agentId: 'xss-agent',
            agentName: '<img src=x onerror=alert(1)>XSS Agent',
            walletAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        }),
    });
    ok(d1.success, `Agent with XSS payload registered`);
    ok(!d1.agent.agentName.includes('<img'), `XSS payload stripped from name`);

    // Invalid wallet
    const { status: s2 } = await fetchJSON('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agentId: 'bad-wallet',
            agentName: 'Bad Wallet',
            walletAddress: 'not_a_solana_address!!',
        }),
    });
    ok(s2 === 400, `Invalid wallet rejected (got ${s2})`);

    // Invalid agentId
    const { status: s3 } = await fetchJSON('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agentId: 'ab',
            agentName: 'Short ID',
            walletAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        }),
    });
    ok(s3 === 400, `Short agentId (2 chars) rejected (got ${s3})`);
}

async function test5_concurrent() {
    console.log('\n🔐 5. CONCURRENT WRITE SAFETY');

    // Register 20 agents simultaneously
    const promises = [];
    for (let i = 0; i < 20; i++) {
        promises.push(fetchJSON('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId: `concurrent-${i}`,
                agentName: `Concurrent Agent ${i}`,
                walletAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
            }),
        }));
    }

    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 201);
    ok(successes.length === 20, `20 concurrent registrations all succeeded (got ${successes.length}/20)`);

    // Verify all saved correctly
    const { data: statsData } = await fetchJSON('/api/stats');
    ok(statsData.totalAgents >= 22, `Stats show ≥22 agents (got ${statsData.totalAgents})`);

    // Verify no duplicate data corruption
    const uniqueIds = new Set(results.map(r => r.data.agent?.agentId).filter(Boolean));
    ok(uniqueIds.size === 20, `All 20 agents have unique IDs (got ${uniqueIds.size})`);
}

async function test6_stats() {
    console.log('\n🔐 6. STATS ENDPOINT');
    const { data } = await fetchJSON('/api/stats');
    ok(data.totalTokensLaunched !== undefined, `Stats has totalTokensLaunched`);
    ok(data.totalAgents !== undefined, `Stats has totalAgents`);
    ok(!JSON.stringify(data).includes('apiKey'), `Stats does NOT contain apiKey`);
}

// ── Run ──
async function main() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  SECURITY + CONSISTENCY TEST SUITE       ║');
    console.log('╚══════════════════════════════════════════╝');
    try {
        await test1_registration();
        await test2_launchAuth();
        await test3_dataPrivacy();
        await test4_inputSanitization();
        await test5_concurrent();
        await test6_stats();
    } catch (e) {
        console.error('\n💥 TEST CRASHED:', e.message);
        fail++;
    }
    console.log(`\n════════════════════════════════════════════`);
    console.log(`Results: ${pass} passed, ${fail} failed`);
    console.log(`════════════════════════════════════════════`);
    process.exit(fail > 0 ? 1 : 0);
}
main();
