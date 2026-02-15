/**
 * Start an embedded PostgreSQL instance for local development.
 * 
 * Usage: node scripts/start-local-pg.js
 * 
 * This will:
 *   1. Download PG binaries (first run only, cached after)
 *   2. Start PG on port 5432
 *   3. Create the clawpump database
 *   4. Keep running until you press Ctrl+C
 */

import EmbeddedPostgres from 'embedded-postgres';

const pg = new EmbeddedPostgres({
    databaseDir: './pg-data',
    user: 'clawpump',
    password: 'clawpump',
    port: 5432,
    persistent: true,
});

async function main() {
    console.log('🐘 Starting embedded PostgreSQL...');
    console.log('   (First run downloads ~200MB of PG binaries, cached after)\n');

    await pg.initialise();
    await pg.start();

    console.log('✅ PostgreSQL running on port 5432');
    console.log('   Connection: postgresql://clawpump:clawpump@localhost:5432/clawpump\n');

    // Create the clawpump database
    try {
        await pg.createDatabase('clawpump');
        console.log('✅ Database "clawpump" created');
    } catch (e) {
        if (e.message?.includes('already exists')) {
            console.log('ℹ  Database "clawpump" already exists');
        } else {
            console.log('⚠  Could not create database:', e.message);
        }
    }

    console.log('\n🚀 Ready! Run "npm run dev" in another terminal.\n');
    console.log('Press Ctrl+C to stop PostgreSQL.\n');

    // Keep process alive
    process.on('SIGINT', async () => {
        console.log('\n🛑 Stopping PostgreSQL...');
        await pg.stop();
        process.exit(0);
    });

    // Keep alive
    await new Promise(() => { });
}

main().catch(err => {
    console.error('Failed to start PostgreSQL:', err);
    process.exit(1);
});
