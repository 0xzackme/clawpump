/**
 * SQLite data layer for ClawDotPump.
 *
 * Replaces the JSON file store with SQLite for:
 *   - Concurrent-safe writes (WAL mode)
 *   - Atomic transactions
 *   - Prepared statements (SQL injection protection)
 *   - Proper indexing
 *
 * API keys are stored as SHA-256 hashes — never in plaintext.
 * Fee split is tracked per token (65% creator / 35% platform).
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { hashApiKey } from './sanitize.js';

const DB_PATH = path.join(process.cwd(), 'data', 'clawdotpump.db');
const FEE_SPLIT = { creator: 0.65, platform: 0.35 };

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Enable WAL mode for concurrent reads + serialized writes
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
        agentId       TEXT PRIMARY KEY,
        agentName     TEXT NOT NULL,
        walletAddress TEXT NOT NULL,
        description   TEXT DEFAULT '',
        platform      TEXT DEFAULT 'api',
        apiKeyHash    TEXT NOT NULL,
        totalEarned   REAL DEFAULT 0,
        totalPending  REAL DEFAULT 0,
        tokensLaunched INTEGER DEFAULT 0,
        reputation    INTEGER DEFAULT 0,
        verified      INTEGER DEFAULT 1,
        createdAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        symbol          TEXT NOT NULL UNIQUE,
        description     TEXT NOT NULL,
        imageUrl        TEXT,
        agentId         TEXT NOT NULL,
        agentName       TEXT NOT NULL,
        walletAddress   TEXT NOT NULL,
        website         TEXT,
        twitter         TEXT,
        telegram        TEXT,
        mintAddress     TEXT,
        txSignature     TEXT,
        pumpUrl         TEXT,
        explorerUrl     TEXT,
        burnTxSig       TEXT,
        devAllocation   REAL DEFAULT 0,
        creatorSharePct REAL DEFAULT 65,
        platformSharePct REAL DEFAULT 35,
        marketCap       REAL DEFAULT 0,
        volume24h       REAL DEFAULT 0,
        totalVolume     REAL DEFAULT 0,
        feesEarned      REAL DEFAULT 0,
        feesPending     REAL DEFAULT 0,
        simulated       INTEGER DEFAULT 0,
        source          TEXT DEFAULT 'api',
        status          TEXT DEFAULT 'active',
        createdAt       TEXT NOT NULL,
        FOREIGN KEY (agentId) REFERENCES agents(agentId)
    );

    CREATE TABLE IF NOT EXISTS processed_posts (
        id          TEXT PRIMARY KEY,
        platform    TEXT NOT NULL,
        agentId     TEXT,
        tokenId     TEXT,
        status      TEXT DEFAULT 'processed',
        errorMsg    TEXT,
        processedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stats (
        id                  INTEGER PRIMARY KEY CHECK (id = 1),
        totalTokensLaunched INTEGER DEFAULT 0,
        totalVolume         REAL DEFAULT 0,
        totalFeesDistributed REAL DEFAULT 0,
        totalAgents         INTEGER DEFAULT 0,
        lastUpdated         TEXT
    );

    -- Ensure stats row exists
    INSERT OR IGNORE INTO stats (id, lastUpdated) VALUES (1, datetime('now'));

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_tokens_agentId ON tokens(agentId);
    CREATE INDEX IF NOT EXISTS idx_tokens_createdAt ON tokens(createdAt);
    CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);
    CREATE INDEX IF NOT EXISTS idx_agents_apiKeyHash ON agents(apiKeyHash);
    CREATE INDEX IF NOT EXISTS idx_processed_posts_platform ON processed_posts(platform);
    CREATE INDEX IF NOT EXISTS idx_agents_walletAddress ON agents(walletAddress);
`);

// ---------------------------------------------------------------------------
// Prepared Statements
// ---------------------------------------------------------------------------

const stmts = {
    // Agents
    getAgentById: db.prepare('SELECT * FROM agents WHERE agentId = ?'),
    getAgentByKeyHash: db.prepare('SELECT * FROM agents WHERE apiKeyHash = ?'),
    insertAgent: db.prepare(`
        INSERT INTO agents (agentId, agentName, walletAddress, description, platform, apiKeyHash, createdAt)
        VALUES (@agentId, @agentName, @walletAddress, @description, @platform, @apiKeyHash, @createdAt)
    `),
    updateAgentTokenCount: db.prepare('UPDATE agents SET tokensLaunched = tokensLaunched + 1 WHERE agentId = ?'),
    countAgents: db.prepare('SELECT COUNT(*) as count FROM agents'),

    // Tokens
    insertToken: db.prepare(`
        INSERT INTO tokens (id, name, symbol, description, imageUrl, agentId, agentName, walletAddress,
            website, twitter, telegram, mintAddress, txSignature, pumpUrl, explorerUrl,
            burnTxSig, devAllocation, creatorSharePct, platformSharePct, simulated, source, createdAt)
        VALUES (@id, @name, @symbol, @description, @imageUrl, @agentId, @agentName, @walletAddress,
            @website, @twitter, @telegram, @mintAddress, @txSignature, @pumpUrl, @explorerUrl,
            @burnTxSig, @devAllocation, @creatorSharePct, @platformSharePct, @simulated, @source, @createdAt)
    `),
    getTokenBySymbol: db.prepare('SELECT * FROM tokens WHERE symbol = ?'),
    getRecentLaunchCountByAgent: db.prepare(`
        SELECT COUNT(*) as count FROM tokens WHERE agentId = ? 
        AND datetime(createdAt) > datetime('now', '-6 hours')
    `),
    getTokensByAgent: db.prepare('SELECT * FROM tokens WHERE agentId = ? ORDER BY createdAt DESC'),
    getAllTokens: db.prepare('SELECT * FROM tokens ORDER BY createdAt DESC'),
    countTokens: db.prepare('SELECT COUNT(*) as count FROM tokens'),

    // Stats
    getStats: db.prepare('SELECT * FROM stats WHERE id = 1'),
    updateStats: db.prepare(`
        UPDATE stats SET 
            totalTokensLaunched = (SELECT COUNT(*) FROM tokens),
            totalAgents = (SELECT COUNT(*) FROM agents),
            lastUpdated = datetime('now')
        WHERE id = 1
    `),

    // Processed posts (scanner dedup)
    getProcessedPost: db.prepare('SELECT * FROM processed_posts WHERE id = ?'),
    insertProcessedPost: db.prepare(`
        INSERT OR IGNORE INTO processed_posts (id, platform, agentId, tokenId, status, errorMsg, processedAt)
        VALUES (@id, @platform, @agentId, @tokenId, @status, @errorMsg, @processedAt)
    `),

    // Agent by wallet
    getAgentByWallet: db.prepare('SELECT * FROM agents WHERE walletAddress = ?'),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// --- Agents ---

export function getAgent(agentId) {
    return stmts.getAgentById.get(agentId) || null;
}

export function getAgentByApiKey(apiKey) {
    const hash = hashApiKey(apiKey);
    return stmts.getAgentByKeyHash.get(hash) || null;
}

export function registerAgent({ agentId, agentName, walletAddress, description, platform, apiKeyHash }) {
    const createdAt = new Date().toISOString();
    stmts.insertAgent.run({ agentId, agentName, walletAddress, description, platform, apiKeyHash, createdAt });
    stmts.updateStats.run();
    return getAgent(agentId);
}

export function agentExists(agentId) {
    return !!stmts.getAgentById.get(agentId);
}

/**
 * Return agent data safe for public display (no API key hash).
 */
export function getPublicAgent(agentId) {
    const agent = getAgent(agentId);
    if (!agent) return null;
    const { apiKeyHash, ...publicData } = agent;
    return publicData;
}

/**
 * Get agent by wallet address (for scanner auto-registration).
 */
export function getAgentByWallet(walletAddress) {
    return stmts.getAgentByWallet.get(walletAddress) || null;
}

/**
 * Register agent from a scanner (no API key, auto-created from platform post).
 */
export function registerAgentFromScan({ agentId, agentName, walletAddress, platform }) {
    // Generate a key but agent won't know it — they can register later via API to get a real key
    const apiKeyHash = hashApiKey(`scan_${agentId}_${Date.now()}`);
    return registerAgent({ agentId, agentName, walletAddress, description: `Auto-registered from ${platform}`, platform, apiKeyHash });
}

// --- Processed Posts (Scanner Dedup) ---

export function isPostProcessed(postId) {
    return !!stmts.getProcessedPost.get(postId);
}

export function markPostProcessed({ id, platform, agentId, tokenId, status = 'processed', errorMsg = null }) {
    stmts.insertProcessedPost.run({
        id, platform, agentId: agentId || null, tokenId: tokenId || null,
        status, errorMsg, processedAt: new Date().toISOString(),
    });
}

// --- Tokens ---

export function insertToken(token) {
    const insert = db.transaction(() => {
        stmts.insertToken.run({
            ...token,
            simulated: token.simulated ? 1 : 0,
            source: token.source || 'api',
        });
        stmts.updateAgentTokenCount.run(token.agentId);
        stmts.updateStats.run();
    });
    insert();
}

export function getTokenBySymbol(symbol) {
    return stmts.getTokenBySymbol.get(symbol.toUpperCase()) || null;
}

export function getRecentLaunchCountByAgent(agentId) {
    const row = stmts.getRecentLaunchCountByAgent.get(agentId);
    return row ? row.count : 0;
}

export function getTokensByAgent(agentId) {
    return stmts.getTokensByAgent.all(agentId);
}

/**
 * Get all tokens with sorting and pagination.
 * Returns only public-safe fields.
 */
export function getTokensPaginated({ sort = 'new', limit = 50, offset = 0 } = {}) {
    let orderBy;
    switch (sort) {
        case 'hot': orderBy = 'volume24h DESC'; break;
        case 'volume': orderBy = 'totalVolume DESC'; break;
        case 'fees': orderBy = 'feesEarned DESC'; break;
        case 'mcap': orderBy = 'marketCap DESC'; break;
        case 'new':
        default: orderBy = 'createdAt DESC'; break;
    }

    const total = stmts.countTokens.get().count;
    const tokens = db.prepare(`
        SELECT name, symbol, description, imageUrl, agentId, agentName,
               mintAddress, pumpUrl, explorerUrl, creatorSharePct, platformSharePct,
               marketCap, volume24h, totalVolume, feesEarned, status, createdAt
        FROM tokens
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
    `).all(limit, offset);

    return { tokens, total, limit, offset, hasMore: offset + limit < total };
}

// --- Leaderboard ---

export function getLeaderboard(limit = 10) {
    return db.prepare(`
        SELECT 
            t.agentId,
            t.agentName,
            COUNT(*) as tokensLaunched,
            SUM(t.feesEarned) as totalEarned,
            SUM(t.totalVolume) as totalVolume
        FROM tokens t
        GROUP BY t.agentId
        ORDER BY totalEarned DESC
        LIMIT ?
    `).all(limit);
}

// --- Stats ---

export function getStats() {
    stmts.updateStats.run();
    const stats = stmts.getStats.get();
    return {
        totalTokensLaunched: stats.totalTokensLaunched,
        totalVolume: stats.totalVolume,
        totalFeesDistributed: stats.totalFeesDistributed,
        totalAgents: stats.totalAgents,
        lastUpdated: stats.lastUpdated,
    };
}

// --- Fee Split Config ---

export function getFeeSplit() {
    return { ...FEE_SPLIT };
}

// --- Migration: import from old JSON store ---

export function migrateFromJson(jsonPath) {
    if (!fs.existsSync(jsonPath)) return false;

    try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        const data = JSON.parse(raw);

        const migrate = db.transaction(() => {
            // Import agents
            for (const agent of (data.agents || [])) {
                const existing = stmts.getAgentById.get(agent.agentId);
                if (existing) continue;

                // Hash existing plaintext API key or generate placeholder hash
                const apiKeyHash = agent.apiKey
                    ? hashApiKey(agent.apiKey)
                    : hashApiKey(`migrated_${agent.agentId}_${Date.now()}`);

                stmts.insertAgent.run({
                    agentId: agent.agentId,
                    agentName: agent.agentName || 'Unknown',
                    walletAddress: agent.walletAddress || '',
                    description: agent.description || '',
                    platform: agent.platform || 'migrated',
                    apiKeyHash,
                    createdAt: agent.createdAt || new Date().toISOString(),
                });
            }

            // Import tokens
            for (const token of (data.tokens || [])) {
                const existing = stmts.getTokenBySymbol.get(token.symbol);
                if (existing) continue;

                stmts.insertToken.run({
                    id: token.id || crypto.randomUUID(),
                    name: token.name,
                    symbol: token.symbol,
                    description: token.description || '',
                    imageUrl: token.imageUrl || null,
                    agentId: token.agentId,
                    agentName: token.agentName || 'Unknown',
                    walletAddress: token.walletAddress || '',
                    website: token.website || null,
                    twitter: token.twitter || null,
                    telegram: token.telegram || null,
                    mintAddress: token.mintAddress || null,
                    txSignature: token.txSignature || token.txHash || null,
                    pumpUrl: token.pumpUrl || null,
                    explorerUrl: token.explorerUrl || null,
                    burnTxSig: token.burnTxSig || null,
                    devAllocation: token.devAllocation || 0,
                    creatorSharePct: 65,
                    platformSharePct: 35,
                    simulated: token.simulated ? 1 : 0,
                    createdAt: token.createdAt || new Date().toISOString(),
                });
            }

            stmts.updateStats.run();
        });

        migrate();

        // Rename old JSON store to .bak
        const bakPath = jsonPath + '.bak';
        fs.renameSync(jsonPath, bakPath);
        console.log(`[DB] Migrated data from ${jsonPath} → SQLite. Old file renamed to ${bakPath}`);
        return true;
    } catch (e) {
        console.error('[DB] Migration failed:', e.message);
        return false;
    }
}

// Auto-migrate on first load
const oldJsonPath = path.join(process.cwd(), 'data', 'store.json');
if (fs.existsSync(oldJsonPath)) {
    migrateFromJson(oldJsonPath);
}

export default db;
