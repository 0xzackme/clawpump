import { NextResponse } from 'next/server';
import { runScan } from '@/lib/scanners/run-scan';
import * as moltbook from '@/lib/scanners/moltbook';

/**
 * GET /api/scan/moltbook — Scan Moltbook for !clawdotpump posts
 * 
 * Protected by SCANNER_SECRET or CRON_SECRET header.
 * Called by cron every minute.
 */
export async function GET(request) {
    // Auth check
    const secret = request.headers.get('x-scanner-secret') || request.headers.get('authorization');
    const expected = process.env.SCANNER_SECRET || process.env.CRON_SECRET;
    if (expected && secret !== `Bearer ${expected}` && secret !== expected) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.MOLTBOOK_API_KEY) {
        return NextResponse.json({ error: 'MOLTBOOK_API_KEY not configured' }, { status: 503 });
    }

    try {
        const results = await runScan({
            platform: 'moltbook',
            fetchPosts: moltbook.fetchNewPosts,
            extractPostData: moltbook.extractPostData,
            reply: moltbook.replyToPost,
        });

        return NextResponse.json({
            success: true,
            platform: 'moltbook',
            ...results,
        });
    } catch (error) {
        console.error('[scan/moltbook] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message,
        }, { status: 500 });
    }
}
