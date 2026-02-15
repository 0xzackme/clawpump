/**
 * Volume Tracker — Periodic job to track cumulative volume
 * 
 * This script:
 * 1. Fetches current 24h volume from DexScreener for all tokens
 * 2. Calculates the delta since last check
 * 3. Updates the cumulative totalVolume in the database
 * 
 * Run via cron: every hour
 */

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://clawpump:clawpump@localhost:5432/clawpump';
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function trackVolume() {
    console.log(`[Volume Tracker] Starting at ${new Date().toISOString()}`);

    try {
        // Get all active tokens with mint addresses
        const { rows: tokens } = await pool.query(
            `SELECT mint_address, symbol, name, volume_24h_last_check, total_volume 
             FROM tokens 
             WHERE mint_address IS NOT NULL 
             AND status = 'active'`
        );

        console.log(`[Volume Tracker] Tracking ${tokens.length} tokens`);

        for (const token of tokens) {
            try {
                // Fetch current 24h volume from DexScreener
                const response = await fetch(
                    `https://api.dexscreener.com/latest/dex/tokens/${token.mint_address}`
                );

                if (!response.ok) {
                    console.warn(`[Volume Tracker] DexScreener API error for ${token.symbol}: ${response.status}`);
                    continue;
                }

                const data = await response.json();
                const pair = data.pairs?.[0]; // First pair (usually the main one)

                if (!pair?.volume?.h24) {
                    console.warn(`[Volume Tracker] No volume data for ${token.symbol}`);
                    continue;
                }

                const currentVolume24h = parseFloat(pair.volume.h24) || 0;
                const lastCheckedVolume = parseFloat(token.volume_24h_last_check) || 0;
                const currentTotalVolume = parseFloat(token.total_volume) || 0;

                // Calculate delta (new volume since last check)
                // Note: This is a simplified approach. 24h volume fluctuates, so we just add the difference
                // For more accuracy, you'd want to track hourly snapshots
                const delta = Math.max(0, currentVolume24h - lastCheckedVolume);

                const newTotalVolume = currentTotalVolume + delta;

                // Update database
                await pool.query(
                    `UPDATE tokens 
                     SET volume_24h_last_check = $1,
                         total_volume = $2,
                         updated_at = NOW()
                     WHERE mint_address = $3`,
                    [currentVolume24h, newTotalVolume, token.mint_address]
                );

                console.log(
                    `[Volume Tracker] ${token.symbol}: 24h=$${currentVolume24h.toFixed(2)}, ` +
                    `delta=+$${delta.toFixed(2)}, total=$${newTotalVolume.toFixed(2)}`
                );

                // Rate limit: wait 100ms between tokens to avoid API throttling
                await new Promise(r => setTimeout(r, 100));

            } catch (err) {
                console.error(`[Volume Tracker] Error tracking ${token.symbol}:`, err.message);
            }
        }

        console.log(`[Volume Tracker] Completed at ${new Date().toISOString()}`);

    } catch (err) {
        console.error('[Volume Tracker] Fatal error:', err);
    } finally {
        await pool.end();
    }
}

trackVolume();
