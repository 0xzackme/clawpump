import { NextResponse } from 'next/server';
import { getAllAgentWallets } from '@/lib/db';
import { decryptPrivateKey } from '@/lib/wallet-crypto';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

/**
 * GET /api/admin/wallets — Admin-only: view all agent wallets with decrypted private keys
 *
 * Protected by ADMIN_API_KEY env var.
 * This is the ONLY way to access agent private keys.
 */
export async function GET(request) {
    // Require admin key
    const apiKey = request.headers.get('x-admin-key') || request.headers.get('x-api-key');

    if (!ADMIN_API_KEY) {
        return NextResponse.json({
            success: false,
            error: 'Admin access not configured. Set ADMIN_API_KEY in .env.',
        }, { status: 503 });
    }

    if (!apiKey || apiKey !== ADMIN_API_KEY) {
        return NextResponse.json({
            success: false,
            error: 'Unauthorized. Provide valid X-Admin-Key header.',
        }, { status: 401 });
    }

    try {
        const wallets = await getAllAgentWallets();

        const result = await Promise.all(wallets.map(async (w) => {
            let privateKeyBase58 = null;
            try {
                const secretKeyBytes = decryptPrivateKey(w.encrypted_key, w.iv, w.auth_tag);
                const bs58 = (await import('bs58')).default;
                privateKeyBase58 = bs58.encode(Buffer.from(secretKeyBytes));
            } catch (e) {
                privateKeyBase58 = `DECRYPT_ERROR: ${e.message}`;
            }

            return {
                agentId: w.agent_id,
                agentName: w.agent_name,
                walletAddress: w.wallet_address,
                privateKey: privateKeyBase58,
                createdAt: w.created_at,
            };
        }));

        return NextResponse.json({
            success: true,
            count: result.length,
            wallets: result,
            warning: 'These are decrypted private keys. Handle with extreme care.',
        });
    } catch (error) {
        console.error('Admin wallets error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal server error',
        }, { status: 500 });
    }
}
