import { NextResponse } from 'next/server';
import { getAgentByApiKey, getPublicAgent, updateAgent } from '@/lib/db';
import { sanitizeText, isValidSolanaAddress } from '@/lib/sanitize';

/**
 * GET /api/agents?id=X — Public agent info (no wallet, no key hash)
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('id');

    if (!agentId) {
        return NextResponse.json({
            message: 'Agent lookup. Use ?id=agent-id for public info, or PATCH with X-API-Key to update.',
        });
    }

    const agent = await getPublicAgent(agentId);
    if (!agent) {
        return NextResponse.json({ success: false, error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({
        success: true,
        agent: {
            agentId: agent.agentId,
            agentName: agent.agentName,
            tokensLaunched: agent.tokensLaunched,
            reputation: agent.reputation,
            createdAt: agent.createdAt,
        }
    });
}

/**
 * PATCH /api/agents — Update agent profile (AUTHENTICATED via X-API-Key)
 *
 * Updatable fields: agentName, description, walletAddress
 * Agent can only update their own profile.
 */
export async function PATCH(request) {
    try {
        const apiKey = request.headers.get('x-api-key');
        if (!apiKey) {
            return NextResponse.json({
                success: false,
                error: 'X-API-Key header required'
            }, { status: 401 });
        }

        const agent = await getAgentByApiKey(apiKey);
        if (!agent) {
            return NextResponse.json({
                success: false,
                error: 'Invalid API key'
            }, { status: 401 });
        }

        const body = await request.json();
        const updates = {};

        if (body.agentName !== undefined) {
            const name = sanitizeText(body.agentName, 100);
            if (!name || name.length < 2) {
                return NextResponse.json({ success: false, error: 'agentName must be 2-100 characters' }, { status: 400 });
            }
            updates.agentName = name;
        }

        if (body.description !== undefined) {
            updates.description = sanitizeText(body.description, 500);
        }

        if (body.walletAddress !== undefined) {
            const wallet = body.walletAddress.trim();
            if (!isValidSolanaAddress(wallet)) {
                return NextResponse.json({ success: false, error: 'Invalid Solana wallet address' }, { status: 400 });
            }
            updates.walletAddress = wallet;
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({
                success: false,
                error: 'No valid fields to update. Supported: agentName, description, walletAddress'
            }, { status: 400 });
        }

        const updated = await updateAgent(agent.agentId, updates);

        return NextResponse.json({
            success: true,
            message: 'Agent updated successfully',
            agent: {
                agentId: updated.agentId,
                agentName: updated.agentName,
                description: updated.description,
                walletAddress: updated.walletAddress,
            }
        });
    } catch (error) {
        console.error('Agent update error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
