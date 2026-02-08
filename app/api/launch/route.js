import { NextResponse } from 'next/server';
import {
    getAgentByApiKey, getTokenBySymbol,
    getRecentLaunchCountByAgent, insertToken, getFeeSplit
} from '@/lib/db';
import { createToken } from '@/lib/pumpfun';
import { sanitizeText, sanitizeSymbol, sanitizeUrl, sanitizeTwitter } from '@/lib/sanitize';

/**
 * POST /api/launch — Launch a new token on pump.fun
 *
 * Authentication: X-API-Key header (REQUIRED — no fallback).
 * Platform wallet pays all gas — agents never need SOL or private keys.
 * Fee split: 70% creator / 30% platform (tracked per token).
 */
export async function POST(request) {
    try {
        // Parse body: support JSON and form-encoded
        let body;
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/x-www-form-urlencoded')) {
            const text = await request.text();
            body = Object.fromEntries(new URLSearchParams(text));
        } else {
            try {
                body = await request.json();
            } catch {
                // Last resort: try parsing as form-encoded
                const text = await request.text();
                body = Object.fromEntries(new URLSearchParams(text));
            }
        }

        // --- Auth: API key REQUIRED ---
        const apiKey = request.headers.get('x-api-key');
        if (!apiKey) {
            return NextResponse.json({
                success: false,
                error: 'Authentication required. Provide X-API-Key header.',
                hint: 'Register at POST /api/register to get an API key.'
            }, { status: 401 });
        }

        const agent = await getAgentByApiKey(apiKey);
        if (!agent) {
            return NextResponse.json({
                success: false,
                error: 'Invalid API key. Register at POST /api/register first.'
            }, { status: 401 });
        }

        // --- Sanitize inputs ---
        const name = sanitizeText(body.name, 32);
        const symbol = sanitizeSymbol(body.symbol);
        const description = sanitizeText(body.description, 500);
        const imageUrl = sanitizeUrl(body.imageUrl);
        const website = sanitizeUrl(body.website);
        const twitter = sanitizeTwitter(body.twitter);
        const telegram = sanitizeText(body.telegram, 100);
        const burnTxSig = sanitizeText(body.burnTxSig, 100);

        // --- Validate required fields ---
        if (!name || !symbol || !description) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: name, symbol, description'
            }, { status: 400 });
        }

        if (description.length < 20) {
            return NextResponse.json({ success: false, error: 'Description must be at least 20 characters' }, { status: 400 });
        }

        // --- Check duplicate ticker ---
        if (await getTokenBySymbol(symbol)) {
            return NextResponse.json({
                success: false,
                error: `Ticker "${symbol}" already launched. Choose a different symbol.`
            }, { status: 409 });
        }

        // --- Rate limiting: 10 launches per agent per 6h ---
        const launchCount = await getRecentLaunchCountByAgent(agent.agentId);
        if (launchCount >= 10) {
            return NextResponse.json({
                success: false,
                error: 'Rate limit: 10 launches per 6 hours per agent',
                launchesUsed: launchCount,
                maxLaunches: 10,
            }, { status: 429 });
        }

        // --- Create token via Pump SDK (platform pays gas) ---
        const result = await createToken({
            name,
            symbol,
            description,
            imageUrl,
            website,
            twitter,
            telegram,
            agentWallet: agent.walletAddress,
        });

        // --- Calculate burn allocation ---
        let devAllocation = 0;
        if (burnTxSig) {
            devAllocation = 1;
        }

        // --- Fee split ---
        const feeSplit = getFeeSplit();

        // --- Save token to database (transaction) ---
        const token = {
            id: crypto.randomUUID(),
            name,
            symbol,
            description,
            imageUrl,
            agentId: agent.agentId,
            agentName: agent.agentName,
            walletAddress: agent.walletAddress,
            website,
            twitter,
            telegram,
            mintAddress: result.mintAddress,
            txSignature: result.txSignature,
            pumpUrl: result.pumpUrl,
            explorerUrl: result.explorerUrl,
            burnTxSig: burnTxSig || null,
            devAllocation,
            creatorSharePct: feeSplit.creator * 100,
            platformSharePct: feeSplit.platform * 100,
            simulated: result.simulated,
            source: 'api',
            feeSharingStatus: result.feeSharingStatus || 'pending',
            feeSharingTx: result.feeSharingTx || null,
        };

        await insertToken(token);

        return NextResponse.json({
            success: true,
            message: `Token "${name}" (${symbol}) launched successfully!`,
            mintAddress: token.mintAddress,
            txSignature: token.txSignature,
            pumpUrl: token.pumpUrl,
            explorerUrl: token.explorerUrl,
            feeSplit: {
                creator: `${feeSplit.creator * 100}%`,
                platform: `${feeSplit.platform * 100}%`,
            },
            feeSharingStatus: result.feeSharingStatus || 'pending',
            gasPaidBy: 'platform',
        }, { status: 201 });
    } catch (error) {
        console.error('Launch error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal server error'
        }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({
        message: 'Token launch endpoint. Use POST to launch.',
        steps: [
            '1. Register: POST /api/register',
            '2. Launch: POST /api/launch with X-API-Key header',
        ],
        requiredFields: ['name', 'symbol', 'description'],
        optionalFields: ['imageUrl', 'website', 'twitter', 'telegram', 'burnTxSig'],
        authentication: 'X-API-Key header from /api/register',
        gasFees: 'Paid by platform — free for agents',
        feeSplit: '70% creator / 30% platform',
    });
}
