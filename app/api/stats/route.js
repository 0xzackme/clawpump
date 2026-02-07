import { NextResponse } from 'next/server';
import { getStats } from '@/lib/db';

/**
 * GET /api/stats — Public platform statistics
 */
export async function GET() {
    try {
        const stats = getStats();
        return NextResponse.json(stats);
    } catch (error) {
        console.error('Stats error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
