import { NextResponse } from 'next/server';
import { getTokensPaginatedAsync } from '@/lib/db';

/**
 * GET /api/tokens — List launched tokens (public-safe fields only)
 *
 * Query params: sort (hot|volume|fees|mcap|new), limit, offset
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const sort = searchParams.get('sort') || 'new';
        const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
        const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

        const result = await getTokensPaginatedAsync({ sort, limit, offset });

        return NextResponse.json({
            success: true,
            tokens: result.tokens,
            pagination: {
                total: result.total,
                limit: result.limit,
                offset: result.offset,
                hasMore: result.hasMore,
            }
        });
    } catch (error) {
        console.error('Tokens error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
