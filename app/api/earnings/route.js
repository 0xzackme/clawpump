import { NextResponse } from 'next/server';
import { getAgentByApiKey, getPublicAgent, getTokensByAgent, getFeeClaimsByAgent } from '@/lib/db';
import { getAgentFeeBalance } from '@/lib/pumpfun';

/**
 * GET /api/earnings — Agent earnings (AUTHENTICATED)
 *
 * v2: Includes claimable fee balance (on-chain) and fee claim history.
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
            agent = await getAgentByApiKey(apiKey);
            if (!agent) {
                return NextResponse.json({
                    success: false,
                    error: 'Invalid API key'
                }, { status: 401 });
            }
        } else if (agentId) {
            agent = await getPublicAgent(agentId);
            if (!agent) {
                return NextResponse.json({
                    success: false,
                    error: 'Agent not found'
                }, { status: 404 });
            }

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

        const agentTokens = await getTokensByAgent(agent.agentId);
        const totalEarned = agentTokens.reduce((sum, t) => sum + (t.feesEarned || 0), 0);
        const totalPending = agentTokens.reduce((sum, t) => sum + (t.feesPending || 0), 0);

        // Get on-chain claimable fees
        let claimable = { balanceLamports: 0, balanceSol: 0 };
        if (agent.walletAddress) {
            claimable = await getAgentFeeBalance(agent.walletAddress);
        }

        // Get claim history
        const claimHistory = await getFeeClaimsByAgent(agent.agentId, { limit: 10, offset: 0 });

        return NextResponse.json({
            success: true,
            agentId: agent.agentId,
            agentName: agent.agentName,
            walletAddress: agent.walletAddress,
            totalEarned: Math.round(totalEarned * 1000) / 1000,
            totalPending: Math.round(totalPending * 1000) / 1000,
            claimable: {
                lamports: claimable.balanceLamports,
                sol: claimable.balanceSol.toFixed(6),
            },
            tokensLaunched: agentTokens.length,
            tokenBreakdown: agentTokens.map(t => ({
                mintAddress: t.mintAddress,
                name: t.name,
                symbol: t.symbol,
                launchType: t.launchType,
                feeSplit: {
                    creator: `${t.creatorSharePct}%`,
                    platform: `${t.platformSharePct}%`,
                },
                feesEarned: t.feesEarned,
                feesPending: t.feesPending,
                volume24h: t.volume24h,
                totalVolume: t.totalVolume,
            })),
            recentClaims: claimHistory.claims.map(c => ({
                txSignature: c.txSignature,
                amountSol: c.amountSol,
                status: c.status,
                createdAt: c.createdAt,
            })),
            claimHint: claimable.balanceLamports > 0
                ? 'POST /api/claim-fees with your X-API-Key to claim accumulated fees.'
                : 'No fees to claim yet.',
        });
    } catch (error) {
        console.error('Earnings error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
