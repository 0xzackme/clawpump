/**
 * Add volume tracking columns + initialize platform token volume
 * 
 * Run this once on VPS:
 * DATABASE_URL=postgresql://... node scripts/add-volume-tracking.js
 */

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://clawpump:clawpump@localhost:5432/clawpump';
const pool = new pg.Pool({ connectionString: DATABASE_URL });

// Platform token mint address
const PLATFORM_TOKEN_MINT = '4jH8AzNS9op6fKNNzxmmagvqpbC2egwHRxBsaUjDfQLk';

// Initial volume to add to platform token (in USD)
const INITIAL_PLATFORM_VOLUME = 72000;

async function migrate() {
    const client = await pool.connect();

    try {
        console.log('🚀 Adding volume tracking columns...\n');

        await client.query('BEGIN');

        // Add volume_24h_last_check column (stores the last 24h volume we saw)
        console.log('1. Adding volume_24h_last_check column...');
        await client.query(`
            ALTER TABLE tokens 
            ADD COLUMN IF NOT EXISTS volume_24h_last_check REAL DEFAULT 0
        `);
        console.log('   ✓ volume_24h_last_check added');

        // Add updated_at column for tracking when volume was last checked
        console.log('\n2. Adding updated_at column...');
        await client.query(`
            ALTER TABLE tokens 
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
        `);
        console.log('   ✓ updated_at added');

        // Initialize platform token with existing volume
        console.log(`\n3. Initializing platform token with $${INITIAL_PLATFORM_VOLUME.toLocaleString()} volume...`);
        const { rowCount } = await client.query(`
            UPDATE tokens 
            SET total_volume = total_volume + $1,
                updated_at = NOW()
            WHERE mint_address = $2
        `, [INITIAL_PLATFORM_VOLUME, PLATFORM_TOKEN_MINT]);

        if (rowCount > 0) {
            console.log(`   ✓ Platform token volume updated`);
        } else {
            console.log(`   ⚠ Platform token not found (mint: ${PLATFORM_TOKEN_MINT})`);
        }

        await client.query('COMMIT');

        // Show current state
        console.log('\n4. Current token volumes:');
        const { rows } = await client.query(`
            SELECT symbol, total_volume, volume_24h, volume_24h_last_check
            FROM tokens
            ORDER BY created_at
        `);

        rows.forEach(row => {
            console.log(`   ${row.symbol}: total=$${row.total_volume.toFixed(2)}, 24h=$${row.volume_24h.toFixed(2)}`);
        });

        console.log('\n✅ Migration complete!');
        console.log('\nNext steps:');
        console.log('1. Test the tracker: DATABASE_URL=... node scripts/track-volume.js');
        console.log('2. Set up cron: crontab -e');
        console.log('   Add: 0 * * * * cd /root/clawpump && DATABASE_URL=... node scripts/track-volume.js >> /var/log/volume-tracker.log 2>&1');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n❌ Migration failed:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
