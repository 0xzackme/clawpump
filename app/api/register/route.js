import { NextResponse } from 'next/server';
import { registerAgent as dbRegisterAgent, agentExists, getPublicAgent, saveAgentWallet } from '@/lib/db';
import { generateApiKey, hashApiKey, sanitizeText, isValidAgentId } from '@/lib/sanitize';
import { generateAgentWallet } from '@/lib/wallet-crypto';

/**
 * POST /api/register — Register a new agent
 *
 * v2: System generates a Solana wallet for the agent.
 * Returns walletAddress + API key. Private key is NEVER exposed.
 *
 * Input: { agentId, agentName }
 * Output: { apiKey, walletAddress }
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
        const description = sanitizeText(body.description || '', 500);
        const platform = sanitizeText(body.platform || 'api', 50);

        // Validate required fields (no wallet needed — system generates it)
        if (!agentId || !agentName) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: agentId, agentName'
            }, { status: 400 });
        }

        if (!isValidAgentId(agentId)) {
            return NextResponse.json({
                success: false,
                error: 'agentId must be 3-50 characters: letters, numbers, hyphens, underscores'
            }, { status: 400 });
        }

        // Check for duplicate agentId
        if (await agentExists(agentId)) {
            return NextResponse.json({
                success: false,
                error: `Agent "${agentId}" is already registered. Use your saved API key to launch tokens. Do NOT re-register.`
            }, { status: 409 });
        }

        // Generate Solana wallet (encrypted private key)
        const wallet = await generateAgentWallet();

        // Generate API key
        const apiKey = generateApiKey();
        const apiKeyHash = hashApiKey(apiKey);

        // Save agent
        await dbRegisterAgent({ agentId, agentName, description, platform, apiKeyHash });

        // Save wallet (encrypted private key stored separately)
        await saveAgentWallet({
            agentId,
            walletAddress: wallet.publicKey,
            encryptedKey: wallet.encrypted,
            iv: wallet.iv,
            authTag: wallet.authTag,
        });

        return NextResponse.json({
            success: true,
            message: `Agent "${agentId}" registered successfully!`,
            agent: {
                agentId,
                agentName,
                walletAddress: wallet.publicKey,
            },
            walletAddress: wallet.publicKey,
            apiKey,
            instructions: {
                step1: `SAVE YOUR API KEY: ${apiKey}`,
                step2: `Your wallet: ${wallet.publicKey}`,
                step3: 'Fund your wallet with 2M+ $CLAWDPUMP for FREE launches, or 0.02+ SOL for PAID launches',
                step4: 'Use X-API-Key header with POST /api/launch to launch tokens',
                clawdpump: 'Buy $CLAWDPUMP: https://pump.fun/coin/4jH8AzNS9op6fKNNzxmmagvqpbC2egwHRxBsaUjDfQLk',
            },
            hint: 'SAVE YOUR API KEY. It cannot be recovered. Your private key is managed securely by the platform.',
        }, { status: 201 });
    } catch (error) {
        console.error('Registration error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * GET /api/register?agentId=X — Check if agent is registered
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
        return NextResponse.json({
            message: 'Agent registration endpoint',
            usage: {
                register: 'POST /api/register with { agentId, agentName }',
                check: 'GET /api/register?agentId=your-agent-id',
            },
            note: 'v2: System generates a Solana wallet for you. No wallet address needed during registration.',
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
            walletAddress: agent.walletAddress,
            tokensLaunched: agent.tokensLaunched,
            reputation: agent.reputation,
            createdAt: agent.createdAt,
        }
    });
}
