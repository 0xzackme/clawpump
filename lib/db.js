/**
 * PostgreSQL data layer for ClawdPump v3.
 *
 * v3 changes:
 *   - System-managed wallets (agent_wallets table with encrypted private keys)
 *   - Dual launch tiers: free (2M $CLAWDPUMP, 70/30) and paid (SOL, 85/15)
 *   - Two treasury wallets: free + paid
 *   - Fee claim tracking (fee_claims table)
 *   - launch_type column on tokens
 *
 * Reliability:
 *   - Mutex-protected schema initialization (no concurrent deadlocks)
 *   - Advisory lock for safe migrations across processes
 *   - Auto-retry on transient errors (deadlock, connection reset) with backoff
 *   - Proper connection pooling for production scale
 *
 * API keys stored as SHA-256 hashes — never in plaintext.
 * Private keys encrypted with AES-256-GCM — see wallet-crypto.js.
 */

import pg from 'pg';
import { hashApiKey } from './sanitize.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://clawpump:clawpump@localhost:5432/clawpump';

// Fee splits — configurable via env
const FREE_SPLIT = {
    creator: parseFloat(process.env.FREE_CREATOR_SHARE || '0.70'),
    platform: parseFloat(process.env.FREE_PLATFORM_SHARE || '0.30'),
};
const PAID_SPLIT = {
    creator: parseFloat(process.env.PAID_CREATOR_SHARE || '0.85'),
    platform: parseFloat(process.env.PAID_PLATFORM_SHARE || '0.15'),
};

// ---------------------------------------------------------------------------
// Connection Pool — production-grade configuration
// ---------------------------------------------------------------------------

const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,                        // Max connections
    min: 2,                         // Keep 2 warm connections
    idleTimeoutMillis: 30000,       // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // Wait up to 10s for a connection
    statement_timeout: 30000,       // Kill queries running > 30s
    keepAlive: true,                // TCP keep-alive for long-lived connections
    keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
});

// ---------------------------------------------------------------------------
// Retry logic for transient database errors
// ---------------------------------------------------------------------------

const RETRYABLE_CODES = new Set([
    '40P01', // deadlock_detected
    '40001', // serialization_failure
    '57P01', // admin_shutdown
    '08006', // connection_failure
    '08003', // connection_does_not_exist
    '08001', // sqlclient_unable_to_establish_sqlconnection
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
]);

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

/**
 * Execute a database operation with automatic retry on transient errors.
 * Uses exponential backoff with jitter.
 *
 * @param {Function} fn — async function to execute
 * @param {string}   label — descriptive label for logging
 * @returns {Promise<*>}
 */
async function withRetry(fn, label = 'query') {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const code = err.code || err.message || '';
            const isRetryable = RETRYABLE_CODES.has(code) ||
                (typeof code === 'string' && (code.includes('ECONNRESET') || code.includes('EPIPE')));

            if (!isRetryable || attempt === MAX_RETRIES) {
                throw err;
            }

            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 100;
            console.warn(`[DB] Retryable error in ${label} (attempt ${attempt}/${MAX_RETRIES}, code=${code}). Retrying in ${Math.round(delay)}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastError;
}

/**
 * Execute a single query with retry.
 */
async function queryWithRetry(text, params, label = 'query') {
    return withRetry(() => pool.query(text, params), label);
}

// ---------------------------------------------------------------------------
// Schema initialization — mutex-protected, advisory-locked
// ---------------------------------------------------------------------------

const INIT_SQL = `
    CREATE TABLE IF NOT EXISTS agents (
        agent_id        TEXT PRIMARY KEY,
        agent_name      TEXT NOT NULL,
        description     TEXT DEFAULT '',
        platform        TEXT DEFAULT 'api',
        api_key_hash    TEXT NOT NULL,
        total_earned    REAL DEFAULT 0,
        total_pending   REAL DEFAULT 0,
        tokens_launched INTEGER DEFAULT 0,
        reputation      INTEGER DEFAULT 0,
        verified        BOOLEAN DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_wallets (
        agent_id       TEXT PRIMARY KEY REFERENCES agents(agent_id) ON DELETE CASCADE,
        wallet_address TEXT NOT NULL UNIQUE,
        encrypted_key  TEXT NOT NULL,
        iv             TEXT NOT NULL,
        auth_tag       TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tokens (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        symbol             TEXT NOT NULL UNIQUE,
        description        TEXT NOT NULL,
        image_url          TEXT,
        agent_id           TEXT NOT NULL REFERENCES agents(agent_id),
        agent_name         TEXT NOT NULL,
        wallet_address     TEXT NOT NULL,
        website            TEXT,
        twitter            TEXT,
        telegram           TEXT,
        mint_address       TEXT,
        tx_signature       TEXT,
        pump_url           TEXT,
        explorer_url       TEXT,
        burn_tx_sig        TEXT,
        dev_allocation     REAL DEFAULT 0,
        launch_type        TEXT DEFAULT 'free',
        creator_share_pct  REAL DEFAULT 70,
        platform_share_pct REAL DEFAULT 30,
        market_cap         REAL DEFAULT 0,
        volume_24h         REAL DEFAULT 0,
        total_volume       REAL DEFAULT 0,
        fees_earned        REAL DEFAULT 0,
        fees_pending       REAL DEFAULT 0,
        simulated          BOOLEAN DEFAULT FALSE,
        source             TEXT DEFAULT 'api',
        status             TEXT DEFAULT 'active',
        fee_sharing_status TEXT DEFAULT 'pending',
        fee_sharing_tx     TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fee_claims (
        id              TEXT PRIMARY KEY,
        agent_id        TEXT NOT NULL REFERENCES agents(agent_id),
        mint_address    TEXT,
        amount_lamports BIGINT DEFAULT 0,
        amount_sol      REAL DEFAULT 0,
        tx_signature    TEXT NOT NULL,
        status          TEXT DEFAULT 'completed',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS processed_posts (
        id           TEXT PRIMARY KEY,
        platform     TEXT NOT NULL,
        agent_id     TEXT,
        token_id     TEXT,
        status       TEXT DEFAULT 'processed',
        error_msg    TEXT,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stats (
        id                     INTEGER PRIMARY KEY CHECK (id = 1),
        total_tokens_launched  INTEGER DEFAULT 0,
        total_volume           REAL DEFAULT 0,
        total_fees_distributed REAL DEFAULT 0,
        total_agents           INTEGER DEFAULT 0,
        last_updated           TIMESTAMPTZ DEFAULT NOW()
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_tokens_agent_id ON tokens(agent_id);
    CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at);
    CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);
    CREATE INDEX IF NOT EXISTS idx_tokens_launch_type ON tokens(launch_type);
    CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
    CREATE INDEX IF NOT EXISTS idx_agent_wallets_address ON agent_wallets(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_fee_claims_agent ON fee_claims(agent_id);
    CREATE INDEX IF NOT EXISTS idx_processed_posts_platform ON processed_posts(platform);

    -- Ensure stats row exists
    INSERT INTO stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
`;

// Migration SQL — separated from schema creation to avoid deadlocks.
// Each ALTER runs individually and is idempotent.
const MIGRATION_SQLS = [
    `ALTER TABLE tokens ADD COLUMN IF NOT EXISTS fee_sharing_status TEXT DEFAULT 'pending'`,
    `ALTER TABLE tokens ADD COLUMN IF NOT EXISTS fee_sharing_tx TEXT`,
    `ALTER TABLE tokens ADD COLUMN IF NOT EXISTS launch_type TEXT DEFAULT 'free'`,
];

let initialized = false;
let initPromise = null; // Mutex: only one init runs at a time

async function ensureInit() {
    if (initialized) return;

    // Mutex: if another init is running, wait for it instead of starting a second one
    if (initPromise) {
        await initPromise;
        return;
    }

    initPromise = _doInit();
    try {
        await initPromise;
    } finally {
        initPromise = null;
    }
}

async function _doInit() {
    const client = await pool.connect();
    try {
        // Use PostgreSQL advisory lock to prevent concurrent schema changes
        // across multiple server processes (e.g. Next.js hot-reload spawning workers)
        await client.query('SELECT pg_advisory_lock(12345)');

        try {
            // Create tables and indexes
            await client.query(INIT_SQL);

            // Run migrations one by one (avoids deadlocks from concurrent ALTER TABLE)
            for (const sql of MIGRATION_SQLS) {
                try {
                    await client.query(sql);
                } catch (err) {
                    // Ignore "column already exists" or similar safe errors
                    if (!err.message?.includes('already exists')) {
                        console.warn('[DB] Migration warning:', err.message);
                    }
                }
            }

            initialized = true;
            console.log('[DB] PostgreSQL schema initialized (v3)');
        } finally {
            await client.query('SELECT pg_advisory_unlock(12345)');
        }
    } catch (err) {
        console.error('[DB] Schema init error:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// Auto-initialize on import
ensureInit().catch(console.error);

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function getAgent(agentId) {
    await ensureInit();
    const { rows } = await queryWithRetry(
        `SELECT a.*, w.wallet_address
         FROM agents a
         LEFT JOIN agent_wallets w ON a.agent_id = w.agent_id
         WHERE a.agent_id = $1`,
        [agentId], 'getAgent'
    );
    return rows[0] ? mapAgentRow(rows[0]) : null;
}

export async function getAgentByApiKey(apiKey) {
    await ensureInit();
    const hash = hashApiKey(apiKey);
    const { rows } = await queryWithRetry(
        `SELECT a.*, w.wallet_address
         FROM agents a
         LEFT JOIN agent_wallets w ON a.agent_id = w.agent_id
         WHERE a.api_key_hash = $1`,
        [hash], 'getAgentByApiKey'
    );
    return rows[0] ? mapAgentRow(rows[0]) : null;
}

export async function registerAgent({ agentId, agentName, description, platform, apiKeyHash }) {
    await ensureInit();
    await queryWithRetry(
        `INSERT INTO agents (agent_id, agent_name, description, platform, api_key_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [agentId, agentName, description || '', platform || 'api', apiKeyHash], 'registerAgent'
    );
    await refreshStats();
    return getAgent(agentId);
}

export async function agentExists(agentId) {
    await ensureInit();
    const { rows } = await queryWithRetry('SELECT 1 FROM agents WHERE agent_id = $1', [agentId], 'agentExists');
    return rows.length > 0;
}

export async function getPublicAgent(agentId) {
    const agent = await getAgent(agentId);
    if (!agent) return null;
    const { apiKeyHash, ...publicData } = agent;
    return publicData;
}

export async function getAgentByWallet(walletAddress) {
    await ensureInit();
    const { rows } = await queryWithRetry(
        `SELECT a.*, w.wallet_address
         FROM agents a
         JOIN agent_wallets w ON a.agent_id = w.agent_id
         WHERE w.wallet_address = $1`,
        [walletAddress], 'getAgentByWallet'
    );
    return rows[0] ? mapAgentRow(rows[0]) : null;
}

export async function registerAgentFromScan({ agentId, agentName, platform }) {
    const apiKeyHash = hashApiKey(`scan_${agentId}_${Date.now()}`);
    return registerAgent({ agentId, agentName, description: `Auto-registered from ${platform}`, platform, apiKeyHash });
}

/**
 * Update agent fields (authenticated).
 */
export async function updateAgent(agentId, updates) {
    await ensureInit();
    const allowed = ['agentName', 'description'];
    const dbFields = { agentName: 'agent_name', description: 'description' };
    const sets = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
        if (updates[key] !== undefined) {
            sets.push(`${dbFields[key]} = $${idx}`);
            values.push(updates[key]);
            idx++;
        }
    }

    if (sets.length === 0) return null;
    values.push(agentId);
    await queryWithRetry(`UPDATE agents SET ${sets.join(', ')} WHERE agent_id = $${idx}`, values, 'updateAgent');
    return getAgent(agentId);
}

function mapAgentRow(row) {
    return {
        agentId: row.agent_id,
        agentName: row.agent_name,
        walletAddress: row.wallet_address || null,
        description: row.description,
        platform: row.platform,
        apiKeyHash: row.api_key_hash,
        totalEarned: row.total_earned,
        totalPending: row.total_pending,
        tokensLaunched: row.tokens_launched,
        reputation: row.reputation,
        verified: row.verified,
        createdAt: row.created_at,
    };
}

// ---------------------------------------------------------------------------
// Agent Wallets (encrypted private keys)
// ---------------------------------------------------------------------------

export async function saveAgentWallet({ agentId, walletAddress, encryptedKey, iv, authTag }) {
    await ensureInit();
    await queryWithRetry(
        `INSERT INTO agent_wallets (agent_id, wallet_address, encrypted_key, iv, auth_tag)
         VALUES ($1, $2, $3, $4, $5)`,
        [agentId, walletAddress, encryptedKey, iv, authTag], 'saveAgentWallet'
    );
}

export async function getAgentWallet(agentId) {
    await ensureInit();
    const { rows } = await queryWithRetry(
        'SELECT * FROM agent_wallets WHERE agent_id = $1',
        [agentId], 'getAgentWallet'
    );
    return rows[0] || null;
}

export async function getAgentWalletByAddress(walletAddress) {
    await ensureInit();
    const { rows } = await queryWithRetry(
        'SELECT * FROM agent_wallets WHERE wallet_address = $1',
        [walletAddress], 'getAgentWalletByAddress'
    );
    return rows[0] || null;
}

export async function getAllAgentWallets() {
    await ensureInit();
    const { rows } = await queryWithRetry(
        `SELECT w.*, a.agent_name
         FROM agent_wallets w
         JOIN agents a ON w.agent_id = a.agent_id
         ORDER BY w.created_at DESC`,
        [], 'getAllAgentWallets'
    );
    return rows;
}

// ---------------------------------------------------------------------------
// Processed Posts (Scanner Dedup)
// ---------------------------------------------------------------------------

export async function isPostProcessed(postId) {
    await ensureInit();
    const { rows } = await queryWithRetry('SELECT 1 FROM processed_posts WHERE id = $1', [postId], 'isPostProcessed');
    return rows.length > 0;
}

export async function markPostProcessed({ id, platform, agentId, tokenId, status = 'processed', errorMsg = null }) {
    await ensureInit();
    await queryWithRetry(
        `INSERT INTO processed_posts (id, platform, agent_id, token_id, status, error_msg)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [id, platform, agentId || null, tokenId || null, status, errorMsg], 'markPostProcessed'
    );
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export async function insertToken(token) {
    await ensureInit();
    return withRetry(async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO tokens (id, name, symbol, description, image_url, agent_id, agent_name, wallet_address,
                    website, twitter, telegram, mint_address, tx_signature, pump_url, explorer_url,
                    burn_tx_sig, dev_allocation, launch_type, creator_share_pct, platform_share_pct,
                    simulated, source, fee_sharing_status, fee_sharing_tx)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
                [
                    token.id, token.name, token.symbol, token.description, token.imageUrl,
                    token.agentId, token.agentName, token.walletAddress,
                    token.website || null, token.twitter || null, token.telegram || null,
                    token.mintAddress || null, token.txSignature || null,
                    token.pumpUrl || null, token.explorerUrl || null,
                    token.burnTxSig || null, token.devAllocation || 0,
                    token.launchType || 'free',
                    token.creatorSharePct || 70, token.platformSharePct || 30,
                    token.simulated || false, token.source || 'api',
                    token.feeSharingStatus || 'pending', token.feeSharingTx || null,
                ]
            );
            await client.query('UPDATE agents SET tokens_launched = tokens_launched + 1 WHERE agent_id = $1', [token.agentId]);
            await client.query(`
                UPDATE stats SET
                    total_tokens_launched = (SELECT COUNT(*) FROM tokens),
                    total_agents = (SELECT COUNT(*) FROM agents),
                    last_updated = NOW()
                WHERE id = 1
            `);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => { });
            throw err;
        } finally {
            client.release();
        }
    }, 'insertToken');
}

export async function getTokenBySymbol(symbol) {
    await ensureInit();
    const { rows } = await queryWithRetry('SELECT * FROM tokens WHERE symbol = $1', [symbol.toUpperCase()], 'getTokenBySymbol');
    return rows[0] ? mapTokenRow(rows[0]) : null;
}

export async function getRecentLaunchCountByAgent(agentId) {
    await ensureInit();
    const { rows } = await queryWithRetry(
        `SELECT COUNT(*) as count FROM tokens WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [agentId], 'getRecentLaunchCount'
    );
    return parseInt(rows[0]?.count || 0);
}

export async function getRecentFreeLaunchCountByAgent(agentId) {
    await ensureInit();
    const { rows } = await queryWithRetry(
        `SELECT COUNT(*) as count FROM tokens WHERE agent_id = $1 AND launch_type = 'free' AND created_at > NOW() - INTERVAL '24 hours'`,
        [agentId], 'getRecentFreeLaunchCount'
    );
    return parseInt(rows[0]?.count || 0);
}

export async function getTokensByAgent(agentId) {
    await ensureInit();
    const { rows } = await queryWithRetry('SELECT * FROM tokens WHERE agent_id = $1 ORDER BY created_at DESC', [agentId], 'getTokensByAgent');
    return rows.map(mapTokenRow);
}

export async function getTokensByAgentPaginated(agentId, { limit = 20, offset = 0 } = {}) {
    await ensureInit();
    const countResult = await queryWithRetry('SELECT COUNT(*) as count FROM tokens WHERE agent_id = $1', [agentId], 'getTokensByAgentPaginated.count');
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await queryWithRetry(
        `SELECT * FROM tokens WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [agentId, limit, offset], 'getTokensByAgentPaginated'
    );

    return {
        tokens: rows.map(mapTokenRow),
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
    };
}

export function getTokensPaginated({ sort = 'new', limit = 50, offset = 0 } = {}) {
    return getTokensPaginatedAsync({ sort, limit, offset });
}

export async function getTokensPaginatedAsync({ sort = 'new', limit = 50, offset = 0 } = {}) {
    await ensureInit();
    const orderMap = {
        hot: 'volume_24h DESC',
        volume: 'total_volume DESC',
        fees: 'fees_earned DESC',
        mcap: 'market_cap DESC',
        new: 'created_at DESC',
    };
    const orderBy = orderMap[sort] || 'created_at DESC';

    const countResult = await queryWithRetry('SELECT COUNT(*) as count FROM tokens', [], 'getTokensPaginated.count');
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await queryWithRetry(
        `SELECT name, symbol, description, image_url, agent_id, agent_name,
                mint_address, pump_url, explorer_url, launch_type,
                creator_share_pct, platform_share_pct,
                market_cap, volume_24h, total_volume, fees_earned, status, source, created_at
         FROM tokens ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
        [limit, offset], 'getTokensPaginated'
    );

    return {
        tokens: rows.map(mapTokenRowPublic),
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
    };
}

function mapTokenRow(row) {
    return {
        id: row.id,
        name: row.name,
        symbol: row.symbol,
        description: row.description,
        imageUrl: row.image_url,
        agentId: row.agent_id,
        agentName: row.agent_name,
        walletAddress: row.wallet_address,
        website: row.website,
        twitter: row.twitter,
        telegram: row.telegram,
        mintAddress: row.mint_address,
        txSignature: row.tx_signature,
        pumpUrl: row.pump_url,
        explorerUrl: row.explorer_url,
        burnTxSig: row.burn_tx_sig,
        devAllocation: row.dev_allocation,
        launchType: row.launch_type,
        creatorSharePct: row.creator_share_pct,
        platformSharePct: row.platform_share_pct,
        marketCap: row.market_cap,
        volume24h: row.volume_24h,
        totalVolume: row.total_volume,
        feesEarned: row.fees_earned,
        feesPending: row.fees_pending,
        simulated: row.simulated,
        source: row.source,
        status: row.status,
        feeSharingStatus: row.fee_sharing_status,
        feeSharingTx: row.fee_sharing_tx,
        createdAt: row.created_at,
    };
}

function mapTokenRowPublic(row) {
    return {
        name: row.name,
        symbol: row.symbol,
        description: row.description,
        imageUrl: row.image_url,
        agentId: row.agent_id,
        agentName: row.agent_name,
        mintAddress: row.mint_address,
        pumpUrl: row.pump_url,
        explorerUrl: row.explorer_url,
        launchType: row.launch_type,
        creatorSharePct: row.creator_share_pct,
        platformSharePct: row.platform_share_pct,
        marketCap: row.market_cap,
        volume24h: row.volume_24h,
        totalVolume: row.total_volume,
        feesEarned: row.fees_earned,
        status: row.status,
        source: row.source,
        feeSharingStatus: row.fee_sharing_status,
        createdAt: row.created_at,
    };
}

// ---------------------------------------------------------------------------
// Fee Sharing Status
// ---------------------------------------------------------------------------

export async function updateTokenFeeSharing(tokenId, status, txSignature = null) {
    await ensureInit();
    await queryWithRetry(
        `UPDATE tokens SET fee_sharing_status = $1, fee_sharing_tx = $2 WHERE id = $3`,
        [status, txSignature, tokenId], 'updateTokenFeeSharing'
    );
}

export async function getTokensPendingFeeSharing() {
    await ensureInit();
    const { rows } = await queryWithRetry(
        `SELECT * FROM tokens WHERE fee_sharing_status = 'pending' AND mint_address IS NOT NULL ORDER BY created_at ASC`,
        [], 'getTokensPendingFeeSharing'
    );
    return rows.map(mapTokenRow);
}

// ---------------------------------------------------------------------------
// Fee Claims
// ---------------------------------------------------------------------------

export async function insertFeeClaim({ id, agentId, mintAddress, amountLamports, amountSol, txSignature, status }) {
    await ensureInit();
    await queryWithRetry(
        `INSERT INTO fee_claims (id, agent_id, mint_address, amount_lamports, amount_sol, tx_signature, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, agentId, mintAddress || null, amountLamports || 0, amountSol || 0, txSignature, status || 'completed'],
        'insertFeeClaim'
    );
}

export async function getFeeClaimsByAgent(agentId, { limit = 20, offset = 0 } = {}) {
    await ensureInit();
    const countResult = await queryWithRetry('SELECT COUNT(*) as count FROM fee_claims WHERE agent_id = $1', [agentId], 'getFeeClaimsByAgent.count');
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await queryWithRetry(
        `SELECT * FROM fee_claims WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [agentId, limit, offset], 'getFeeClaimsByAgent'
    );

    return {
        claims: rows.map(r => ({
            id: r.id,
            agentId: r.agent_id,
            mintAddress: r.mint_address,
            amountLamports: parseInt(r.amount_lamports),
            amountSol: r.amount_sol,
            txSignature: r.tx_signature,
            status: r.status,
            createdAt: r.created_at,
        })),
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
    };
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function getLeaderboard(limit = 10) {
    await ensureInit();
    const { rows } = await queryWithRetry(
        `SELECT t.agent_id, t.agent_name,
                COUNT(*) as tokens_launched,
                SUM(t.fees_earned) as total_earned,
                SUM(t.total_volume) as total_volume
         FROM tokens t
         GROUP BY t.agent_id, t.agent_name
         ORDER BY total_earned DESC
         LIMIT $1`,
        [limit], 'getLeaderboard'
    );
    return rows.map(r => ({
        agentId: r.agent_id,
        agentName: r.agent_name,
        tokensLaunched: parseInt(r.tokens_launched),
        totalEarned: parseFloat(r.total_earned || 0),
        totalVolume: parseFloat(r.total_volume || 0),
    }));
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

async function refreshStats() {
    await queryWithRetry(`
        UPDATE stats SET
            total_tokens_launched = (SELECT COUNT(*) FROM tokens),
            total_agents = (SELECT COUNT(*) FROM agents),
            last_updated = NOW()
        WHERE id = 1
    `, [], 'refreshStats');
}

export async function getStats() {
    await ensureInit();
    await refreshStats();
    const { rows } = await queryWithRetry('SELECT * FROM stats WHERE id = 1', [], 'getStats');
    const s = rows[0];
    return {
        totalTokensLaunched: s.total_tokens_launched,
        totalVolume: s.total_volume,
        totalFeesDistributed: s.total_fees_distributed,
        totalAgents: s.total_agents,
        lastUpdated: s.last_updated,
    };
}

// ---------------------------------------------------------------------------
// Fee Split Config
// ---------------------------------------------------------------------------

export function getFeeSplit(launchType = 'free') {
    if (launchType === 'paid') return { ...PAID_SPLIT };
    return { ...FREE_SPLIT };
}

export default pool;
