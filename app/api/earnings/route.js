import { NextResponse } from 'next/server';
import { getAgentByApiKey, getPublicAgent, getTokensByAgent } from '@/lib/db';

/**
 * GET /api/earnings — Agent earnings (AUTHENTICATED)
 *
 * Requires X-API-Key header. Agents can only see their own earnings.
 * Falls back to agentId query param for public summary (limited data).
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const agentId = searchParams.get('agentId');
        const apiKey = request.headers.get('x-api-key');

        let agent;

        if (apiKey) {
            // Authenticated — full earnings data
            agent = getAgentByApiKey(apiKey);
            if (!agent) {
                return NextResponse.json({
                    success: false,
                    error: 'Invalid API key'
                }, { status: 401 });
            }
        } else if (agentId) {
            // Public — limited summary only
            agent = getPublicAgent(agentId);
            if (!agent) {
                return NextResponse.json({
                    success: false,
                    error: 'Agent not found'
                }, { status: 404 });
            }

            // Public view — only basic stats, no detailed breakdown
            return NextResponse.json({
                success: true,
                agentId: agent.agentId,
                agentName: agent.agentName,
                tokensLaunched: agent.tokensLaunched,
                totalEarned: Math.round((agent.totalEarned || 0) * 1000) / 1000,
            });
        } else {
            return NextResponse.json({
                success: false,
                error: 'Provide X-API-Key header for full data, or ?agentId= for public summary'
            }, { status: 400 });
        }

        // Authenticated view — full breakdown
        const agentTokens = getTokensByAgent(agent.agentId);
        const totalEarned = agentTokens.reduce((sum, t) => sum + (t.feesEarned || 0), 0);
        const totalPending = agentTokens.reduce((sum, t) => sum + (t.feesPending || 0), 0);

        return NextResponse.json({
            success: true,
            agentId: agent.agentId,
            agentName: agent.agentName,
            totalEarned: Math.round(totalEarned * 1000) / 1000,
            totalPending: Math.round(totalPending * 1000) / 1000,
            tokensLaunched: agentTokens.length,
            feeSplit: {
                creator: `${agentTokens[0]?.creatorSharePct || 65}%`,
                platform: `${agentTokens[0]?.platformSharePct || 35}%`,
            },
            tokenBreakdown: agentTokens.map(t => ({
                mintAddress: t.mintAddress,
                name: t.name,
                symbol: t.symbol,
                feesEarned: t.feesEarned,
                feesPending: t.feesPending,
                volume24h: t.volume24h,
                totalVolume: t.totalVolume,
            }))
        });
    } catch (error) {
        console.error('Earnings error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
