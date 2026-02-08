import { NextResponse } from 'next/server';
import { registerAgent as dbRegisterAgent, agentExists, getPublicAgent } from '@/lib/db';
import { generateApiKey, hashApiKey, sanitizeText, isValidSolanaAddress, isValidAgentId } from '@/lib/sanitize';

/**
 * POST /api/register — Register a new agent
 *
 * Returns API key ONLY in this response. Agent must save it.
 * Key is stored as SHA-256 hash — never retrievable again.
 */
export async function POST(request) {
    try {
        let body;
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/x-www-form-urlencoded')) {
            const text = await request.text();
            body = Object.fromEntries(new URLSearchParams(text));
        } else {
            try {
                body = await request.json();
            } catch {
                const text = await request.text();
                body = Object.fromEntries(new URLSearchParams(text));
            }
        }
        const agentId = sanitizeText(body.agentId, 50);
        const agentName = sanitizeText(body.agentName, 100);
        const walletAddress = (body.walletAddress || '').trim();
        const description = sanitizeText(body.description || '', 500);
        const platform = sanitizeText(body.platform || 'api', 50);

        // Validate required fields
        if (!agentId || !agentName || !walletAddress) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: agentId, agentName, walletAddress'
            }, { status: 400 });
        }

        if (!isValidAgentId(agentId)) {
            return NextResponse.json({
                success: false,
                error: 'agentId must be 3-50 characters: letters, numbers, hyphens, underscores'
            }, { status: 400 });
        }

        if (!isValidSolanaAddress(walletAddress)) {
            return NextResponse.json({
                success: false,
                error: 'walletAddress must be a valid Solana address (32-44 base58 characters)'
            }, { status: 400 });
        }

        // Check for duplicate agentId
        if (await agentExists(agentId)) {
            return NextResponse.json({
                success: false,
                error: `Agent "${agentId}" is already registered. Use your saved API key to launch tokens. Do NOT re-register.`
            }, { status: 409 });
        }

        // Check if wallet is already registered under a different agent
        const { getAgentByWallet } = await import('@/lib/db');
        const existingByWallet = await getAgentByWallet(walletAddress);
        if (existingByWallet) {
            return NextResponse.json({
                success: false,
                error: `This wallet is already registered as agent "${existingByWallet.agentId}". Use your existing API key to launch tokens. Do NOT re-register.`,
                existingAgent: {
                    agentId: existingByWallet.agentId,
                    agentName: existingByWallet.agentName,
                }
            }, { status: 409 });
        }

        // Generate API key, hash it for storage
        const apiKey = generateApiKey();
        const apiKeyHash = hashApiKey(apiKey);

        await dbRegisterAgent({ agentId, agentName, walletAddress, description, platform, apiKeyHash });

        return NextResponse.json({
            success: true,
            message: `Agent "${agentId}" registered successfully`,
            agent: {
                agentId,
                agentName,
                walletAddress,
            },
            // ⚠️ API key returned ONLY here. Stored as hash — cannot be recovered.
            apiKey,
            hint: 'SAVE YOUR API KEY. It cannot be recovered. Use it in the X-API-Key header for /api/launch.'
        }, { status: 201 });
    } catch (error) {
        console.error('Registration error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * GET /api/register?agentId=X — Check if agent is registered
 *
 * NEVER returns API key, hash, or wallet address.
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
        return NextResponse.json({
            message: 'Agent registration endpoint',
            usage: {
                register: 'POST /api/register with { agentId, agentName, walletAddress }',
                check: 'GET /api/register?agentId=your-agent-id',
            }
        });
    }

    const agent = await getPublicAgent(agentId);

    if (!agent) {
        return NextResponse.json({
            success: false,
            registered: false,
            error: `Agent "${agentId}" not found`
        }, { status: 404 });
    }

    return NextResponse.json({
        success: true,
        registered: true,
        agent: {
            agentId: agent.agentId,
            agentName: agent.agentName,
            tokensLaunched: agent.tokensLaunched,
            reputation: agent.reputation,
            createdAt: agent.createdAt,
        }
    });
}
