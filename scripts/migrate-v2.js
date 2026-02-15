/**
 * Migration script: ClawdPump v2 → v3 (dual treasury model)
 *
 * This script:
 *   1. Creates new tables (agent_wallets, fee_claims)
 *   2. Adds launch_type column to tokens
 *   3. Removes all data EXCEPT the official $CLAWDPUMP token and its deployer
 *   4. Re-generates wallet for the official deployer
 *
 * Usage:
 *   WALLET_ENCRYPTION_KEY=<key> DATABASE_URL=<url> node scripts/migrate-v2.js
 *
 * ⚠️ THIS IS DESTRUCTIVE — backup your database before running!
 */

import pg from 'pg';
import crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://clawpump:clawpump@localhost:5432/clawpump';

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// The official $CLAWDPUMP token mint address
const OFFICIAL_CLAWDPUMP_MINT = '4jH8AzNS9op6fKNNzxmmagvqpbC2egwHRxBsaUjDfQLk';

async function migrate() {
    const client = await pool.connect();

    try {
        console.log('🚀 Starting ClawdPump v3 migration...\n');

        await client.query('BEGIN');

        // 1. Create new tables
        console.log('1. Creating new tables...');

        await client.query(`
            CREATE TABLE IF NOT EXISTS agent_wallets (
                agent_id       TEXT PRIMARY KEY,
                wallet_address TEXT NOT NULL UNIQUE,
                encrypted_key  TEXT NOT NULL,
                iv             TEXT NOT NULL,
                auth_tag       TEXT NOT NULL,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        console.log('   ✓ agent_wallets table created');

        await client.query(`
            CREATE TABLE IF NOT EXISTS fee_claims (
                id              TEXT PRIMARY KEY,
                agent_id        TEXT NOT NULL,
                mint_address    TEXT,
                amount_lamports BIGINT DEFAULT 0,
                amount_sol      REAL DEFAULT 0,
                tx_signature    TEXT NOT NULL,
                status          TEXT DEFAULT 'completed',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        console.log('   ✓ fee_claims table created');

        // 2. Add launch_type column to tokens
        console.log('\n2. Adding launch_type column to tokens...');
        await client.query(`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS launch_type TEXT DEFAULT 'free'`);
        console.log('   ✓ launch_type column added');

        // 3. Find the official $CLAWDPUMP token
        console.log('\n3. Finding official $CLAWDPUMP token...');
        const { rows: officialTokens } = await client.query(
            'SELECT * FROM tokens WHERE mint_address = $1',
            [OFFICIAL_CLAWDPUMP_MINT]
        );

        let officialAgentId = null;
        if (officialTokens.length > 0) {
            officialAgentId = officialTokens[0].agent_id;
            console.log(`   ✓ Found official token by agent: ${officialAgentId}`);
        } else {
            console.log('   ⚠ No official $CLAWDPUMP token found in database');
        }

        // 4. Remove all data except official token and its deployer
        console.log('\n4. Removing non-official data...');

        // Delete processed posts
        await client.query('DELETE FROM processed_posts');
        console.log('   ✓ Cleared processed_posts');

        // Delete fee_claims (new table, should be empty)
        await client.query('DELETE FROM fee_claims');
        console.log('   ✓ Cleared fee_claims');

        // Delete tokens except official one
        if (officialAgentId) {
            const { rowCount: tokensDeleted } = await client.query(
                'DELETE FROM tokens WHERE mint_address != $1 OR mint_address IS NULL',
                [OFFICIAL_CLAWDPUMP_MINT]
            );
            console.log(`   ✓ Deleted ${tokensDeleted} non-official tokens`);
        } else {
            const { rowCount: tokensDeleted } = await client.query('DELETE FROM tokens');
            console.log(`   ✓ Deleted ${tokensDeleted} tokens (no official token found)`);
        }

        // Delete agent_wallets
        await client.query('DELETE FROM agent_wallets');
        console.log('   ✓ Cleared agent_wallets');

        // Delete agents except official deployer
        if (officialAgentId) {
            // First drop wallet_address column from agents if it exists
            try {
                await client.query('ALTER TABLE agents DROP COLUMN IF EXISTS wallet_address');
                console.log('   ✓ Dropped wallet_address column from agents');
            } catch (e) {
                console.log('   ℹ wallet_address column may already be removed or have dependencies');
            }

            const { rowCount: agentsDeleted } = await client.query(
                'DELETE FROM agents WHERE agent_id != $1',
                [officialAgentId]
            );
            console.log(`   ✓ Deleted ${agentsDeleted} non-official agents`);

            // Update official agent's tokens_launched count
            const { rows: tokenCount } = await client.query(
                'SELECT COUNT(*) as count FROM tokens WHERE agent_id = $1',
                [officialAgentId]
            );
            await client.query(
                'UPDATE agents SET tokens_launched = $1 WHERE agent_id = $2',
                [parseInt(tokenCount[0].count), officialAgentId]
            );

            // Generate wallet for official deployer if WALLET_ENCRYPTION_KEY is set
            const keyHex = process.env.WALLET_ENCRYPTION_KEY;
            if (keyHex && keyHex.length === 64) {
                console.log('\n5. Generating wallet for official deployer...');
                const { Keypair } = await import('@solana/web3.js');
                const keypair = Keypair.generate();
                const publicKey = keypair.publicKey.toBase58();

                // Encrypt private key
                const key = Buffer.from(keyHex, 'hex');
                const iv = crypto.randomBytes(12);
                const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
                const encrypted = Buffer.concat([cipher.update(Buffer.from(keypair.secretKey)), cipher.final()]);
                const authTag = cipher.getAuthTag();

                await client.query(
                    `INSERT INTO agent_wallets (agent_id, wallet_address, encrypted_key, iv, auth_tag)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (agent_id) DO UPDATE SET
                         wallet_address = $2, encrypted_key = $3, iv = $4, auth_tag = $5`,
                    [officialAgentId, publicKey, encrypted.toString('hex'), iv.toString('hex'), authTag.toString('hex')]
                );
                console.log(`   ✓ Generated wallet for ${officialAgentId}: ${publicKey}`);
            } else {
                console.log('\n5. SKIPPED wallet generation — WALLET_ENCRYPTION_KEY not set');
            }
        } else {
            const { rowCount: agentsDeleted } = await client.query('DELETE FROM agents');
            console.log(`   ✓ Deleted ${agentsDeleted} agents`);

            // Drop wallet_address column from agents
            try {
                await client.query('ALTER TABLE agents DROP COLUMN IF EXISTS wallet_address');
                console.log('   ✓ Dropped wallet_address column from agents');
            } catch (e) {
                console.log('   ℹ wallet_address column may already be removed');
            }
        }

        // 6. Create indexes
        console.log('\n6. Creating indexes...');
        await client.query('CREATE INDEX IF NOT EXISTS idx_agent_wallets_address ON agent_wallets(wallet_address)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_fee_claims_agent ON fee_claims(agent_id)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_tokens_launch_type ON tokens(launch_type)');
        console.log('   ✓ Indexes created');

        // 7. Refresh stats
        console.log('\n7. Refreshing stats...');
        await client.query(`
            UPDATE stats SET
                total_tokens_launched = (SELECT COUNT(*) FROM tokens),
                total_agents = (SELECT COUNT(*) FROM agents),
                last_updated = NOW()
            WHERE id = 1
        `);
        console.log('   ✓ Stats refreshed');

        await client.query('COMMIT');

        // Summary
        const { rows: agentCount } = await client.query('SELECT COUNT(*) as count FROM agents');
        const { rows: tokenCountFinal } = await client.query('SELECT COUNT(*) as count FROM tokens');
        const { rows: walletCount } = await client.query('SELECT COUNT(*) as count FROM agent_wallets');

        console.log('\n✅ Migration complete!');
        console.log(`   Agents: ${agentCount[0].count}`);
        console.log(`   Tokens: ${tokenCountFinal[0].count}`);
        console.log(`   Wallets: ${walletCount[0].count}`);
        console.log(`\n⚠️ Make sure to set these env vars:`);
        console.log(`   WALLET_ENCRYPTION_KEY=<64-char-hex>`);
        console.log(`   PAID_TREASURY_PRIVATE_KEY=<base58>`);
        console.log(`   PAID_LAUNCH_COST_SOL=0.02`);
        console.log(`   ADMIN_API_KEY=<your-admin-key>`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n❌ Migration failed:', err.message);
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
