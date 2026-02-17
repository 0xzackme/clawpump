import { NextResponse } from 'next/server';
import { getAgentByApiKey } from '@/lib/db';
import { getAgentKeypair } from '@/lib/wallet-crypto';
import { sendSol, sendSplToken, getBalance } from '@/lib/solana-transfer';
import { PublicKey } from '@solana/web3.js';

/**
 * POST /api/send — Send SOL or SPL tokens from agent's embedded wallet
 *
 * Auth: X-API-Key header
 * Body: { to, amount, token, memo? }
 */
export async function POST(request) {
    try {
        // --- Auth ---
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
                error: 'Invalid API key',
            }, { status: 401 });
        }

        // --- Parse body ---
        const body = await request.json();
        const { to, amount, token, memo } = body;

        // --- Validate inputs ---
        if (!to || !amount || !token) {
            return NextResponse.json({
                success: false,
                error: 'Missing required fields: to, amount, token',
                example: {
                    to: 'RECIPIENT_SOLANA_ADDRESS',
                    amount: 0.5,
                    token: 'SOL' // or SPL token mint address
                }
            }, { status: 400 });
        }

        // Validate recipient address
        try {
            new PublicKey(to);
        } catch (err) {
            return NextResponse.json({
                success: false,
                error: 'Invalid recipient Solana address',
            }, { status: 400 });
        }

        // Validate amount
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return NextResponse.json({
                success: false,
                error: 'Amount must be a positive number',
            }, { status: 400 });
        }

        // Validate token (SOL or valid mint address)
        const isSol = token === 'SOL' || token === 'sol';
        if (!isSol) {
            try {
                new PublicKey(token);
            } catch (err) {
                return NextResponse.json({
                    success: false,
                    error: 'Invalid token mint address. Use "SOL" for native SOL, or provide a valid SPL token mint address.',
                }, { status: 400 });
            }
        }

        // --- Load agent's keypair ---
        const keypair = await getAgentKeypair(agent.agentId);

        // --- Check balance ---
        const balance = await getBalance(agent.walletAddress, isSol ? 'SOL' : token);

        if (balance < parsedAmount) {
            return NextResponse.json({
                success: false,
                error: 'Insufficient balance',
                balance: balance,
                requested: parsedAmount,
                token: isSol ? 'SOL' : token,
            }, { status: 402 });
        }

        // --- Execute transfer ---
        let result;
        if (isSol) {
            result = await sendSol(keypair, to, parsedAmount);
        } else {
            // For SPL tokens, amount needs to be in token's smallest unit
            // This is a simplification - in production you'd fetch token decimals
            result = await sendSplToken(keypair, to, token, parsedAmount);
        }

        // --- Return success ---
        return NextResponse.json({
            success: true,
            message: `Sent ${parsedAmount} ${isSol ? 'SOL' : 'tokens'}`,
            signature: result.signature,
            explorer: result.explorer,
            from: agent.walletAddress,
            to: to,
            amount: parsedAmount,
            token: isSol ? 'SOL' : token,
            fee: result.fee,
            memo: memo || null,
        });

    } catch (error) {
        console.error('[/api/send] Error:', error);

        // Handle specific errors
        if (error.message?.includes('Recipient token account does not exist')) {
            return NextResponse.json({
                success: false,
                error: 'Recipient token account does not exist',
                hint: 'Ask the recipient to create their token account first, or use a wallet that auto-creates ATAs.',
            }, { status: 400 });
        }

        if (error.message?.includes('No wallet found')) {
            return NextResponse.json({
                success: false,
                error: 'Agent wallet not found. Register first at /api/register.',
            }, { status: 404 });
        }

        return NextResponse.json({
            success: false,
            error: 'Transfer failed',
            details: error.message,
        }, { status: 500 });
    }
}
