import { NextResponse } from 'next/server';
import { getLeaderboard } from '@/lib/db';

/**
 * GET /api/leaderboard — Public leaderboard (safe data only)
 *
 * No API keys, wallet addresses, or internal data exposed.
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 50);

        const leaderboard = getLeaderboard(limit).map((agent, i) => ({
            rank: i + 1,
            agentId: agent.agentId,
            agentName: agent.agentName,
            tokensLaunched: agent.tokensLaunched,
            totalEarned: Math.round((agent.totalEarned || 0) * 1000) / 1000,
        }));

        return NextResponse.json({ success: true, leaderboard });
    } catch (error) {
        console.error('Leaderboard error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
