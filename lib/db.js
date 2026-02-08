/**
 * PostgreSQL data layer for ClawdPump.
 *
 * Migrated from SQLite to PostgreSQL for:
 *   - True concurrent writes (no WAL serialization)
 *   - Connection pooling (handles many simultaneous agents)
 *   - Production-grade scaling
 *   - Proper async/await patterns
 *
 * API keys are stored as SHA-256 hashes — never in plaintext.
 * Fee split is tracked per token (70% creator / 30% platform).
 */

import pg from 'pg';
import { hashApiKey } from './sanitize.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://clawpump:clawpump@localhost:5432/clawpump';
const FEE_SPLIT = { creator: 0.70, platform: 0.30 };

// Connection pool — max 20 connections, idle timeout 30s
const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
});

// ---------------------------------------------------------------------------
// Schema initialization (runs once on startup)
// ---------------------------------------------------------------------------

const INIT_SQL = `
    CREATE TABLE IF NOT EXISTS agents (
        agent_id        TEXT PRIMARY KEY,
        agent_name      TEXT NOT NULL,
        wallet_address  TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS tokens (
        id                TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        symbol            TEXT NOT NULL UNIQUE,
        description       TEXT NOT NULL,
        image_url         TEXT,
        agent_id          TEXT NOT NULL REFERENCES agents(agent_id),
        agent_name        TEXT NOT NULL,
        wallet_address    TEXT NOT NULL,
        website           TEXT,
        twitter           TEXT,
        telegram          TEXT,
        mint_address      TEXT,
        tx_signature      TEXT,
        pump_url          TEXT,
        explorer_url      TEXT,
        burn_tx_sig       TEXT,
        dev_allocation    REAL DEFAULT 0,
        creator_share_pct REAL DEFAULT 70,
        platform_share_pct REAL DEFAULT 30,
        market_cap        REAL DEFAULT 0,
        volume_24h        REAL DEFAULT 0,
        total_volume      REAL DEFAULT 0,
        fees_earned       REAL DEFAULT 0,
        fees_pending      REAL DEFAULT 0,
        simulated         BOOLEAN DEFAULT FALSE,
        source            TEXT DEFAULT 'api',
        status            TEXT DEFAULT 'active',
        fee_sharing_status TEXT DEFAULT 'pending',
        fee_sharing_tx    TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
    CREATE INDEX IF NOT EXISTS idx_agents_wallet_address ON agents(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_processed_posts_platform ON processed_posts(platform);

    -- Ensure stats row exists
    INSERT INTO stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    -- Migration: add fee_sharing columns if missing
    DO $$
    BEGIN
        ALTER TABLE tokens ADD COLUMN IF NOT EXISTS fee_sharing_status TEXT DEFAULT 'pending';
        ALTER TABLE tokens ADD COLUMN IF NOT EXISTS fee_sharing_tx TEXT;
    END $$;
`;

let initialized = false;
async function ensureInit() {
    if (initialized) return;
    try {
        await pool.query(INIT_SQL);
        initialized = true;
        console.log('[DB] PostgreSQL schema initialized');
    } catch (err) {
        console.error('[DB] Schema init error:', err.message);
        throw err;
    }
}

// Auto-initialize on import
ensureInit().catch(console.error);

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function getAgent(agentId) {
    await ensureInit();
    const { rows } = await pool.query('SELECT * FROM agents WHERE agent_id = $1', [agentId]);
    return rows[0] ? mapAgentRow(rows[0]) : null;
}

export async function getAgentByApiKey(apiKey) {
    await ensureInit();
    const hash = hashApiKey(apiKey);
    const { rows } = await pool.query('SELECT * FROM agents WHERE api_key_hash = $1', [hash]);
    return rows[0] ? mapAgentRow(rows[0]) : null;
}

export async function registerAgent({ agentId, agentName, walletAddress, description, platform, apiKeyHash }) {
    await ensureInit();
    await pool.query(
        `INSERT INTO agents (agent_id, agent_name, wallet_address, description, platform, api_key_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [agentId, agentName, walletAddress, description || '', platform || 'api', apiKeyHash]
    );
    await refreshStats();
    return getAgent(agentId);
}

export async function agentExists(agentId) {
    await ensureInit();
    const { rows } = await pool.query('SELECT 1 FROM agents WHERE agent_id = $1', [agentId]);
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
    const { rows } = await pool.query('SELECT * FROM agents WHERE wallet_address = $1', [walletAddress]);
    return rows[0] ? mapAgentRow(rows[0]) : null;
}

export async function registerAgentFromScan({ agentId, agentName, walletAddress, platform }) {
    const apiKeyHash = hashApiKey(`scan_${agentId}_${Date.now()}`);
    return registerAgent({ agentId, agentName, walletAddress, description: `Auto-registered from ${platform}`, platform, apiKeyHash });
}

/**
 * Update agent fields (authenticated — agent can change name, description, wallet).
 */
export async function updateAgent(agentId, updates) {
    await ensureInit();
    const allowed = ['agentName', 'description', 'walletAddress'];
    const dbFields = { agentName: 'agent_name', description: 'description', walletAddress: 'wallet_address' };
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
    await pool.query(`UPDATE agents SET ${sets.join(', ')} WHERE agent_id = $${idx}`, values);
    return getAgent(agentId);
}

// Map snake_case DB row to camelCase JS object
function mapAgentRow(row) {
    return {
        agentId: row.agent_id,
        agentName: row.agent_name,
        walletAddress: row.wallet_address,
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
// Processed Posts (Scanner Dedup)
// ---------------------------------------------------------------------------

export async function isPostProcessed(postId) {
    await ensureInit();
    const { rows } = await pool.query('SELECT 1 FROM processed_posts WHERE id = $1', [postId]);
    return rows.length > 0;
}

export async function markPostProcessed({ id, platform, agentId, tokenId, status = 'processed', errorMsg = null }) {
    await ensureInit();
    await pool.query(
        `INSERT INTO processed_posts (id, platform, agent_id, token_id, status, error_msg)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [id, platform, agentId || null, tokenId || null, status, errorMsg]
    );
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export async function insertToken(token) {
    await ensureInit();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO tokens (id, name, symbol, description, image_url, agent_id, agent_name, wallet_address,
                website, twitter, telegram, mint_address, tx_signature, pump_url, explorer_url,
                burn_tx_sig, dev_allocation, creator_share_pct, platform_share_pct, simulated, source,
                fee_sharing_status, fee_sharing_tx)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
            [
                token.id, token.name, token.symbol, token.description, token.imageUrl,
                token.agentId, token.agentName, token.walletAddress,
                token.website || null, token.twitter || null, token.telegram || null,
                token.mintAddress || null, token.txSignature || null,
                token.pumpUrl || null, token.explorerUrl || null,
                token.burnTxSig || null, token.devAllocation || 0,
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
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function getTokenBySymbol(symbol) {
    await ensureInit();
    const { rows } = await pool.query('SELECT * FROM tokens WHERE symbol = $1', [symbol.toUpperCase()]);
    return rows[0] ? mapTokenRow(rows[0]) : null;
}

export async function getRecentLaunchCountByAgent(agentId) {
    await ensureInit();
    const { rows } = await pool.query(
        `SELECT COUNT(*) as count FROM tokens WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '6 hours'`,
        [agentId]
    );
    return parseInt(rows[0]?.count || 0);
}

export async function getTokensByAgent(agentId) {
    await ensureInit();
    const { rows } = await pool.query('SELECT * FROM tokens WHERE agent_id = $1 ORDER BY created_at DESC', [agentId]);
    return rows.map(mapTokenRow);
}

export function getTokensPaginated({ sort = 'new', limit = 50, offset = 0 } = {}) {
    // This is called synchronously by market-data — we need a sync wrapper
    // Use a cached approach
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

    const countResult = await pool.query('SELECT COUNT(*) as count FROM tokens');
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await pool.query(
        `SELECT name, symbol, description, image_url, agent_id, agent_name,
                mint_address, pump_url, explorer_url, creator_share_pct, platform_share_pct,
                market_cap, volume_24h, total_volume, fees_earned, status, source, created_at
         FROM tokens ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
        [limit, offset]
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
    await pool.query(
        `UPDATE tokens SET fee_sharing_status = $1, fee_sharing_tx = $2 WHERE id = $3`,
        [status, txSignature, tokenId]
    );
}

export async function getTokensPendingFeeSharing() {
    await ensureInit();
    const { rows } = await pool.query(
        `SELECT * FROM tokens WHERE fee_sharing_status = 'pending' AND mint_address IS NOT NULL ORDER BY created_at ASC`
    );
    return rows.map(mapTokenRow);
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function getLeaderboard(limit = 10) {
    await ensureInit();
    const { rows } = await pool.query(
        `SELECT t.agent_id, t.agent_name,
                COUNT(*) as tokens_launched,
                SUM(t.fees_earned) as total_earned,
                SUM(t.total_volume) as total_volume
         FROM tokens t
         GROUP BY t.agent_id, t.agent_name
         ORDER BY total_earned DESC
         LIMIT $1`,
        [limit]
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
    await pool.query(`
        UPDATE stats SET
            total_tokens_launched = (SELECT COUNT(*) FROM tokens),
            total_agents = (SELECT COUNT(*) FROM agents),
            last_updated = NOW()
        WHERE id = 1
    `);
}

export async function getStats() {
    await ensureInit();
    await refreshStats();
    const { rows } = await pool.query('SELECT * FROM stats WHERE id = 1');
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

export function getFeeSplit() {
    return { ...FEE_SPLIT };
}

export default pool;
