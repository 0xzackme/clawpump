/**
 * ClawdPump — End-to-End Test Script
 *
 * Tests the full flow:
 *   1. Register agent
 *   2. Launch token
 *   3. Check tokens list
 *   4. Check agent earnings
 *   5. Check platform stats
 *   6. Verify rate limiting
 *   7. Verify duplicate prevention
 *
 * Usage: node scripts/test-flow.js
 * Requires: dev server running at http://localhost:3000
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Colors for terminal output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function pass(msg) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function fail(msg) { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`  ${DIM}${msg}${RESET}`); }
function header(msg) { console.log(`\n${BOLD}${CYAN}═══ ${msg} ═══${RESET}`); }

let passed = 0;
let failed = 0;
let apiKey = null;

function assert(condition, msg) {
    if (condition) { pass(msg); passed++; }
    else { fail(msg); failed++; }
}

async function fetchJSON(path, opts = {}) {
    const url = `${BASE_URL}${path}`;
    const resp = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...opts.headers },
        ...opts,
    });
    const data = await resp.json();
    return { status: resp.status, data };
}

// ═══════════════════════════════════════════════════════════════════

async function testHealthCheck() {
    header('Step 0: Health Check');
    const { status, data } = await fetchJSON('/api/health');
    assert(status === 200, `Health check returns 200 (got ${status})`);
    assert(data.status === 'ok', `Health status is "ok"`);
}

async function testRegisterAgent() {
    header('Step 1: Register Agent');

    // Test with missing fields
    const { status: s1, data: d1 } = await fetchJSON('/api/register', {
        method: 'POST',
        body: JSON.stringify({ agentId: 'test-agent' }),
    });
    assert(s1 === 400, `Missing fields returns 400 (got ${s1})`);

    // Test with invalid wallet
    const { status: s2, data: d2 } = await fetchJSON('/api/register', {
        method: 'POST',
        body: JSON.stringify({
            agentId: 'test-agent',
            agentName: 'Test Agent',
            walletAddress: '0xINVALID', // EVM address, should fail
        }),
    });
    assert(s2 === 400, `Invalid wallet (EVM format) returns 400 (got ${s2})`);
    info(`Error: ${d2.error}`);

    // Test successful registration
    const { status: s3, data: d3 } = await fetchJSON('/api/register', {
        method: 'POST',
        body: JSON.stringify({
            agentId: 'test-agent-001',
            agentName: 'Test Agent Alpha',
            walletAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
            description: 'Automated test agent for ClawdPump platform',
            platform: 'test-script',
        }),
    });
    assert(s3 === 201, `Registration returns 201 (got ${s3})`);
    assert(d3.success === true, `Registration success`);
    assert(d3.agent?.apiKey, `API key generated: ${d3.agent?.apiKey?.slice(0, 20)}...`);
    apiKey = d3.agent?.apiKey;

    // Test duplicate registration
    const { status: s4, data: d4 } = await fetchJSON('/api/register', {
        method: 'POST',
        body: JSON.stringify({
            agentId: 'test-agent-001',
            agentName: 'Test Agent Alpha',
            walletAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        }),
    });
    assert(s4 === 409, `Duplicate registration returns 409 (got ${s4})`);

    // Test GET check
    const { status: s5, data: d5 } = await fetchJSON('/api/register?agentId=test-agent-001');
    assert(s5 === 200, `GET check returns 200 (got ${s5})`);
    assert(d5.registered === true, `Agent is registered`);

    // Test GET for non-existent agent
    const { status: s6 } = await fetchJSON('/api/register?agentId=nonexistent');
    assert(s6 === 404, `Non-existent agent returns 404 (got ${s6})`);
}

async function testLaunchToken() {
    header('Step 2: Launch Token');

    // Test without auth
    const { status: s1, data: d1 } = await fetchJSON('/api/launch', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', symbol: 'TST', description: 'A test token for testing purposes and verification' }),
    });
    assert(s1 === 401, `Unauthenticated launch returns 401 (got ${s1})`);

    // Test with unregistered agent
    const { status: s2 } = await fetchJSON('/api/launch', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Test',
            symbol: 'TST',
            description: 'A test token for testing purposes and verification',
            agentId: 'unregistered-agent',
        }),
    });
    assert(s2 === 401, `Unregistered agent returns 401 (got ${s2})`);

    // Test with bad description (too short)
    const { status: s3 } = await fetchJSON('/api/launch', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Test',
            symbol: 'TST',
            description: 'Too short',
            agentId: 'test-agent-001',
        }),
    });
    assert(s3 === 400, `Short description returns 400 (got ${s3})`);

    // Test successful launch (via agentId)
    const { status: s4, data: d4 } = await fetchJSON('/api/launch', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Alpha Agent Token',
            symbol: 'AAT',
            description: 'The first autonomous AI agent token on Solana via ClawdPump',
            imageUrl: 'https://iili.io/example.jpg',
            agentId: 'test-agent-001',
            website: 'https://alpha-agent.xyz',
            twitter: '@AlphaAgent',
        }),
    });
    assert(s4 === 201, `Token launch returns 201 (got ${s4})`);
    assert(d4.success === true, `Launch success`);
    assert(d4.mintAddress, `Mint address: ${d4.mintAddress?.slice(0, 20)}...`);
    assert(d4.txSignature, `Tx signature: ${d4.txSignature?.slice(0, 20)}...`);
    assert(d4.pumpUrl, `pump.fun URL: ${d4.pumpUrl}`);
    assert(d4.gasPaidBy === 'platform', `Gas paid by: ${d4.gasPaidBy}`);
    info(`Simulated: ${d4.simulated}`);

    // Test with API key auth
    const { status: s5, data: d5 } = await fetchJSON('/api/launch', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey },
        body: JSON.stringify({
            name: 'Beta Agent Token',
            symbol: 'BAT',
            description: 'Second token launched with API key authentication on ClawdPump',
        }),
    });
    // Should be rate limited (same agent, within 24h)
    assert(s5 === 429, `Rate limited: second launch returns 429 (got ${s5})`);
    info(`Cooldown ends: ${d5.cooldownEnds}`);
}

async function testDuplicateTicker() {
    header('Step 3: Duplicate Ticker Prevention');

    // Register a second agent
    const { data: regData } = await fetchJSON('/api/register', {
        method: 'POST',
        body: JSON.stringify({
            agentId: 'test-agent-002',
            agentName: 'Test Agent Beta',
            walletAddress: '9xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        }),
    });

    // Try to launch with same ticker as Step 2
    const { status, data } = await fetchJSON('/api/launch', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Another Alpha Token',
            symbol: 'AAT',
            description: 'Trying to use the same ticker as the first token launch',
            agentId: 'test-agent-002',
        }),
    });
    assert(status === 409, `Duplicate ticker returns 409 (got ${status})`);
    info(`Error: ${data.error}`);
}

async function testTokensList() {
    header('Step 4: List Tokens');
    const { status, data } = await fetchJSON('/api/tokens');
    assert(status === 200, `Tokens list returns 200 (got ${status})`);
    assert(Array.isArray(data.tokens), `Returns tokens array`);
    assert(data.tokens.length >= 1, `At least 1 token exists (got ${data.tokens.length})`);

    const firstToken = data.tokens[0];
    assert(firstToken.name, `Token has name: ${firstToken.name}`);
    assert(firstToken.symbol, `Token has symbol: ${firstToken.symbol}`);
    assert(firstToken.mintAddress, `Token has mintAddress`);
    assert(firstToken.agentId, `Token has agentId: ${firstToken.agentId}`);
}

async function testEarnings() {
    header('Step 5: Agent Earnings');
    const { status, data } = await fetchJSON('/api/earnings?agentId=test-agent-001');
    assert(status === 200, `Earnings returns 200 (got ${status})`);
    info(`Earnings data: ${JSON.stringify(data).slice(0, 100)}...`);
}

async function testStats() {
    header('Step 6: Platform Stats');
    const { status, data } = await fetchJSON('/api/stats');
    assert(status === 200, `Stats returns 200 (got ${status})`);
    assert(data.totalTokensLaunched >= 1, `Total tokens >= 1 (got ${data.totalTokensLaunched})`);
    assert(data.totalAgents >= 1, `Total agents >= 1 (got ${data.totalAgents})`);
    info(`Stats: ${JSON.stringify(data)}`);
}

async function testLeaderboard() {
    header('Step 7: Leaderboard');
    const { status, data } = await fetchJSON('/api/leaderboard');
    assert(status === 200, `Leaderboard returns 200 (got ${status})`);
    info(`Agents: ${data.leaderboard?.length || 0}`);
}

// ═══════════════════════════════════════════════════════════════════

async function main() {
    console.log(`\n${BOLD}🐾 ClawdPump — End-to-End Test${RESET}`);
    console.log(`${DIM}Server: ${BASE_URL}${RESET}`);
    console.log(`${DIM}Time:   ${new Date().toISOString()}${RESET}`);

    try {
        await testHealthCheck();
        await testRegisterAgent();
        await testLaunchToken();
        await testDuplicateTicker();
        await testTokensList();
        await testEarnings();
        await testStats();
        await testLeaderboard();
    } catch (err) {
        console.error(`\n${RED}FATAL: ${err.message}${RESET}`);
        if (err.cause?.code === 'ECONNREFUSED') {
            console.error(`${YELLOW}Is the dev server running? Start with: npm run dev${RESET}`);
        }
        process.exit(1);
    }

    header('Results');
    console.log(`  ${GREEN}Passed: ${passed}${RESET}`);
    if (failed > 0) console.log(`  ${RED}Failed: ${failed}${RESET}`);
    else console.log(`  ${DIM}Failed: 0${RESET}`);
    console.log(`  Total:  ${passed + failed}`);
    console.log();

    if (failed > 0) {
        console.log(`${RED}${BOLD}SOME TESTS FAILED${RESET}\n`);
        process.exit(1);
    } else {
        console.log(`${GREEN}${BOLD}ALL TESTS PASSED ✓${RESET}\n`);
    }
}

main();
