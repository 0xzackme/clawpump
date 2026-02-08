import { NextResponse } from 'next/server';
import { runScan } from '@/lib/scanners/run-scan';
import * as moltx from '@/lib/scanners/moltx';

/**
 * GET /api/scan/moltx — Scan Moltx for !ClawdPump posts
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

    if (!process.env.MOLTX_API_KEY) {
        return NextResponse.json({ error: 'MOLTX_API_KEY not configured' }, { status: 503 });
    }

    try {
        const results = await runScan({
            platform: 'moltx',
            fetchPosts: moltx.fetchNewPosts,
            extractPostData: moltx.extractPostData,
            reply: moltx.replyToPost,
        });

        return NextResponse.json({
            success: true,
            platform: 'moltx',
            ...results,
        });
    } catch (error) {
        console.error('[scan/moltx] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message,
        }, { status: 500 });
    }
}
