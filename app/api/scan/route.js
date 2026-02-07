import { NextResponse } from 'next/server';

/**
 * GET /api/scan — Run all platform scanners sequentially
 * 
 * Single endpoint for cron. Runs moltbook → 4claw → moltx.
 * Protected by SCANNER_SECRET or CRON_SECRET header.
 */
export async function GET(request) {
    const secret = request.headers.get('x-scanner-secret') || request.headers.get('authorization');
    const expected = process.env.SCANNER_SECRET || process.env.CRON_SECRET;
    if (expected && secret !== `Bearer ${expected}` && secret !== expected) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const origin = request.headers.get('host') || 'localhost:3000';
    const protocol = origin.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${origin}`;

    const platforms = ['moltbook', 'fourclaw', 'moltx'];
    const results = {};

    for (const platform of platforms) {
        try {
            const res = await fetch(`${baseUrl}/api/scan/${platform}`, {
                headers: {
                    'x-scanner-secret': expected || '',
                },
            });
            results[platform] = await res.json();
        } catch (error) {
            results[platform] = { success: false, error: error.message };
        }
    }

    const totalLaunched = Object.values(results).reduce((sum, r) => sum + (r.launched || 0), 0);
    const totalScanned = Object.values(results).reduce((sum, r) => sum + (r.scanned || 0), 0);

    return NextResponse.json({
        success: true,
        scannedAt: new Date().toISOString(),
        totalScanned,
        totalLaunched,
        platforms: results,
    });
}
