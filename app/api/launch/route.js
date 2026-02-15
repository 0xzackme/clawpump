import { NextResponse } from 'next/server';
import {
    getAgentByApiKey, getTokenBySymbol, getAgentWallet,
    getRecentLaunchCountByAgent, getRecentFreeLaunchCountByAgent,
    insertToken, getFeeSplit
} from '@/lib/db';
import { createToken } from '@/lib/pumpfun';
import { sanitizeText, sanitizeSymbol, sanitizeUrl, sanitizeTwitter } from '@/lib/sanitize';
import { checkLaunchEligibility, checkSolBalance, getPaidLaunchCost } from '@/lib/solana-balance';
import { loadKeypairFromEncrypted } from '@/lib/wallet-crypto';

/**
 * POST /api/launch — Launch a new token on pump.fun
 *
 * v3 Dual tier system with auto-fallback:
 *   - FREE: Agent holds 2M+ $CLAWDPUMP → 70/30 fee split, 1 per 24h
 *   - PAID: Agent has 0.02+ SOL → 85/15 fee split, up to 4 per 24h total
 *
 * Auto-fallback: If free limit reached or insufficient $CLAWDPUMP,
 * automatically switches to paid if agent has enough SOL.
 *
 * Supports JSON body or multipart/form-data (with image file upload).
 */
export async function POST(request) {
    try {
        let body;
        let imageBuffer = null;
        let imageMime = null;

        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            // Handle multipart/form-data (with file upload)
            const formData = await request.formData();
            body = {};
            for (const [key, value] of formData.entries()) {
                if (key === 'image' && value instanceof File) {
                    const arrayBuffer = await value.arrayBuffer();
                    imageBuffer = Buffer.from(arrayBuffer);
                    imageMime = value.type || 'image/png';
                } else {
                    body[key] = value;
                }
            }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
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

        // --- Validate required fields ---
        if (!name || !symbol || !description) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: name, symbol, description'
            }, { status: 400 });
        }

        if (description.length < 20) {
            return NextResponse.json({
                success: false,
                error: 'Description must be at least 20 characters'
            }, { status: 400 });
        }

        // --- Check duplicate ticker ---
        if (await getTokenBySymbol(symbol)) {
            return NextResponse.json({
                success: false,
                error: `Ticker "${symbol}" already launched. Choose a different symbol.`
            }, { status: 409 });
        }

        // --- Overall rate limit: 200 launches per 24h (effectively unlimited for paid) ---
        const totalLaunchCount = await getRecentLaunchCountByAgent(agent.agentId);
        if (totalLaunchCount >= 200) {
            return NextResponse.json({
                success: false,
                error: 'Rate limit: 200 launches per 24 hours per agent',
                launchesUsed: totalLaunchCount,
                maxLaunches: 200,
            }, { status: 429 });
        }

        // --- Determine launch tier with auto-fallback ---
        const eligibility = await checkLaunchEligibility(agent.walletAddress);
        let launchType = null;
        let tierNote = null;

        if (eligibility.eligibility === 'free') {
            // Agent has 2M+ $CLAWDPUMP — check free limit (1 per 24h)
            const freeLaunchCount = await getRecentFreeLaunchCountByAgent(agent.agentId);
            if (freeLaunchCount < 1) {
                launchType = 'free';
                tierNote = 'Free launch (2M+ $CLAWDPUMP holder). 70/30 fee split.';
            } else {
                // Free limit reached — auto-fallback to paid if SOL available
                const { hasEnoughForLaunch, balanceSol } = await checkSolBalance(agent.walletAddress);
                if (hasEnoughForLaunch) {
                    launchType = 'paid';
                    tierNote = `Free launch limit reached (1/day). Auto-switched to paid tier (${balanceSol.toFixed(4)} SOL available). 85/15 fee split.`;
                } else {
                    return NextResponse.json({
                        success: false,
                        error: 'Free launch limit reached (1 per 24 hours). Insufficient SOL for paid launch.',
                        freeLaunchesUsed: freeLaunchCount,
                        maxFreeLaunches: 1,
                        hint: `Deposit ${getPaidLaunchCost()} SOL to your wallet for additional paid launches (85/15 fee split).`,
                        yourWallet: agent.walletAddress,
                    }, { status: 429 });
                }
            }
        } else if (eligibility.eligibility === 'paid') {
            launchType = 'paid';
            tierNote = `Paid launch (${eligibility.solBalance.toFixed(4)} SOL). 85/15 fee split.`;
        } else {
            // Cannot launch — no $CLAWDPUMP and no SOL
            return NextResponse.json({
                success: false,
                error: 'Insufficient balance. You need either $CLAWDPUMP or SOL to launch.',
                options: {
                    free: {
                        requirement: '2,000,000+ $CLAWDPUMP in your wallet',
                        feeSplit: '70% you / 30% platform',
                        cost: 'FREE (platform pays gas)',
                        limit: '1 launch per 24 hours',
                        buyLink: 'https://pump.fun/coin/4jH8AzNS9op6fKNNzxmmagvqpbC2egwHRxBsaUjDfQLk',
                    },
                    paid: {
                        requirement: `${getPaidLaunchCost()} SOL in your wallet`,
                        feeSplit: '85% you / 15% platform',
                        cost: `${getPaidLaunchCost()} SOL`,
                        limit: 'unlimited',
                    },
                },
                yourWallet: agent.walletAddress,
                currentBalance: {
                    clawdpump: eligibility.clawdpumpBalance.toLocaleString(),
                    sol: `${eligibility.solBalance.toFixed(4)} SOL`,
                },
            }, { status: 402 });
        }

        // --- For paid launches: load agent keypair for SOL transfer ---
        let agentKeypair = null;
        if (launchType === 'paid') {
            const walletRow = await getAgentWallet(agent.agentId);
            if (!walletRow) {
                return NextResponse.json({
                    success: false,
                    error: 'Agent wallet not found. Please re-register.',
                }, { status: 500 });
            }
            agentKeypair = await loadKeypairFromEncrypted(walletRow);
        }

        // --- Create token via Pump SDK ---
        const feeSplit = getFeeSplit(launchType);

        const result = await createToken({
            name,
            symbol,
            description,
            launchType,
            agentWallet: agent.walletAddress,
            agentKeypair,
            imageUrl,
            imageBuffer,
            imageMime,
            website,
            twitter,
            telegram,
        });

        // --- Save token to database ---
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
            launchType,
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
            launchType,
            tierNote,
            feeSplit: {
                creator: `${feeSplit.creator * 100}%`,
                platform: `${feeSplit.platform * 100}%`,
            },
            feeSharingStatus: result.feeSharingStatus || 'pending',
            gasPaidBy: launchType === 'free' ? 'platform' : `agent (${getPaidLaunchCost()} SOL)`,
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
            '1. Register: POST /api/register with { agentId, agentName }',
            '2. Fund your wallet: deposit 2M+ $CLAWDPUMP (free) or SOL (paid)',
            '3. Launch: POST /api/launch with X-API-Key header',
        ],
        tiers: {
            free: {
                requirement: '2,000,000+ $CLAWDPUMP',
                feeSplit: '70% creator / 30% platform',
                cost: 'FREE (platform pays gas)',
                limit: '1 per 24 hours',
            },
            paid: {
                requirement: `${getPaidLaunchCost()} SOL`,
                feeSplit: '85% creator / 15% platform',
                cost: `${getPaidLaunchCost()} SOL`,
                limit: 'Unlimited (paid per launch)',
            },
        },
        autoFallback: 'If free limit reached, automatically switches to paid tier when SOL is available.',
        requiredFields: ['name', 'symbol', 'description'],
        optionalFields: ['imageUrl', 'image (file)', 'website', 'twitter', 'telegram'],
        authentication: 'X-API-Key header from /api/register',
        supportsMultipart: true,
    });
}
