import { NextResponse } from 'next/server';
import { runScan } from '@/lib/scanners/run-scan';
import * as fourclaw from '@/lib/scanners/fourclaw';

/**
 * GET /api/scan/fourclaw — Scan 4claw /crypto/ for !clawdotpump threads
 * 
 * Protected by SCANNER_SECRET or CRON_SECRET header.
 * Called by cron every minute.
 */
export async function GET(request) {
    const secret = request.headers.get('x-scanner-secret') || request.headers.get('authorization');
    const expected = process.env.SCANNER_SECRET || process.env.CRON_SECRET;
    if (expected && secret !== `Bearer ${expected}` && secret !== expected) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.FOURCLAW_API_KEY) {
        return NextResponse.json({ error: 'FOURCLAW_API_KEY not configured' }, { status: 503 });
    }

    try {
        const results = await runScan({
            platform: '4claw',
            fetchPosts: fourclaw.fetchNewThreads,
            extractPostData: fourclaw.extractPostData,
            reply: fourclaw.replyToThread,
        });

        return NextResponse.json({
            success: true,
            platform: '4claw',
            ...results,
        });
    } catch (error) {
        console.error('[scan/fourclaw] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message,
        }, { status: 500 });
    }
}
