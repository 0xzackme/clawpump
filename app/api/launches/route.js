import { NextResponse } from 'next/server';
import { getAgentByApiKey, getTokensByAgentPaginated, getFeeClaimsByAgent } from '@/lib/db';

/**
 * GET /api/launches — Agent launch history
 *
 * Authentication: X-API-Key header (REQUIRED for own launches)
 * OR ?agentId= for public view (limited data)
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const apiKey = request.headers.get('x-api-key');
        const agentIdParam = searchParams.get('agentId');
        const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        let agentId;

        if (apiKey) {
            const agent = await getAgentByApiKey(apiKey);
            if (!agent) {
                return NextResponse.json({
                    success: false,
                    error: 'Invalid API key.',
                }, { status: 401 });
            }
            agentId = agent.agentId;
        } else if (agentIdParam) {
            agentId = agentIdParam;
        } else {
            return NextResponse.json({
                message: 'Launch history endpoint',
                usage: {
                    authenticated: 'GET /api/launches with X-API-Key header',
                    public: 'GET /api/launches?agentId=your-agent-id',
                },
                pagination: 'Use ?limit=20&offset=0 for pagination',
            });
        }

        const launchData = await getTokensByAgentPaginated(agentId, { limit, offset });

        // If authenticated, also include fee claim history
        let claims = null;
        if (apiKey) {
            claims = await getFeeClaimsByAgent(agentId, { limit: 10, offset: 0 });
        }

        return NextResponse.json({
            success: true,
            agentId,
            launches: launchData.tokens.map(t => ({
                name: t.name,
                symbol: t.symbol,
                mintAddress: t.mintAddress,
                pumpUrl: t.pumpUrl,
                explorerUrl: t.explorerUrl,
                launchType: t.launchType,
                feeSplit: {
                    creator: `${t.creatorSharePct}%`,
                    platform: `${t.platformSharePct}%`,
                },
                feeSharingStatus: t.feeSharingStatus,
                status: t.status,
                createdAt: t.createdAt,
            })),
            pagination: {
                total: launchData.total,
                limit: launchData.limit,
                offset: launchData.offset,
                hasMore: launchData.hasMore,
            },
            ...(claims ? {
                recentClaims: claims.claims.map(c => ({
                    txSignature: c.txSignature,
                    amountSol: c.amountSol,
                    createdAt: c.createdAt,
                })),
            } : {}),
        });
    } catch (error) {
        console.error('Launches error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal server error',
        }, { status: 500 });
    }
}
