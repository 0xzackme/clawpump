import { NextResponse } from 'next/server';
import { getAgentByApiKey, getAgentWallet, insertFeeClaim } from '@/lib/db';
import { claimAgentFees, getAgentFeeBalance } from '@/lib/pumpfun';
import { loadKeypairFromEncrypted } from '@/lib/wallet-crypto';

/**
 * POST /api/claim-fees — Claim accumulated creator fees
 *
 * The platform signs the claim transaction using the agent's encrypted private key.
 * Fees are sent directly to the agent's system-managed wallet on-chain.
 *
 * Authentication: X-API-Key header (REQUIRED)
 */
export async function POST(request) {
    try {
        const apiKey = request.headers.get('x-api-key');
        if (!apiKey) {
            return NextResponse.json({
                success: false,
                error: 'Authentication required. Provide X-API-Key header.',
            }, { status: 401 });
        }

        const agent = await getAgentByApiKey(apiKey);
        if (!agent) {
            return NextResponse.json({
                success: false,
                error: 'Invalid API key.',
            }, { status: 401 });
        }

        // Load agent keypair (decrypt private key)
        const walletRow = await getAgentWallet(agent.agentId);
        if (!walletRow) {
            return NextResponse.json({
                success: false,
                error: 'Agent wallet not found.',
            }, { status: 500 });
        }

        const agentKeypair = await loadKeypairFromEncrypted(walletRow);

        // Claim fees on-chain
        const result = await claimAgentFees(agentKeypair);

        if (!result.txSignature) {
            return NextResponse.json({
                success: true,
                message: 'No fees available to claim.',
                amountClaimed: 0,
                walletAddress: agent.walletAddress,
            });
        }

        // Record the claim
        await insertFeeClaim({
            id: crypto.randomUUID(),
            agentId: agent.agentId,
            mintAddress: null, // claimed all
            amountLamports: result.amountLamports,
            amountSol: result.amountLamports / 1e9,
            txSignature: result.txSignature,
            status: 'completed',
        });

        return NextResponse.json({
            success: true,
            message: 'Fees claimed successfully!',
            txSignature: result.txSignature,
            amountClaimed: {
                lamports: result.amountLamports,
                sol: (result.amountLamports / 1e9).toFixed(6),
            },
            walletAddress: agent.walletAddress,
            explorerUrl: `https://solscan.io/tx/${result.txSignature}`,
            simulated: result.simulated || false,
        });
    } catch (error) {
        console.error('Claim fees error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal server error',
        }, { status: 500 });
    }
}

/**
 * GET /api/claim-fees — Check claimable fee balance
 *
 * Authentication: X-API-Key header (REQUIRED)
 */
export async function GET(request) {
    try {
        const apiKey = request.headers.get('x-api-key');
        if (!apiKey) {
            return NextResponse.json({
                message: 'Fee claiming endpoint',
                usage: {
                    check: 'GET /api/claim-fees with X-API-Key header',
                    claim: 'POST /api/claim-fees with X-API-Key header',
                },
            });
        }

        const agent = await getAgentByApiKey(apiKey);
        if (!agent) {
            return NextResponse.json({
                success: false,
                error: 'Invalid API key.',
            }, { status: 401 });
        }

        const balance = await getAgentFeeBalance(agent.walletAddress);

        return NextResponse.json({
            success: true,
            agentId: agent.agentId,
            walletAddress: agent.walletAddress,
            claimable: {
                lamports: balance.balanceLamports,
                sol: balance.balanceSol.toFixed(6),
            },
            hint: balance.balanceLamports > 0
                ? 'POST /api/claim-fees with your X-API-Key to claim.'
                : 'No fees to claim yet. Launch tokens and earn fees from trading volume.',
        });
    } catch (error) {
        console.error('Check fees error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal server error',
        }, { status: 500 });
    }
}
