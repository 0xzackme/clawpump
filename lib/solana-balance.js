/**
 * Solana balance checker for ClawdPump v2.
 *
 * Three-state launch eligibility:
 *   1. "free"   — wallet holds 2M+ $CLAWDPUMP → free launch (70/30)
 *   2. "paid"   — wallet has 0.02+ SOL → paid launch (85/15)
 *   3. "cannot" — neither → show both options
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const CLAWDPUMP_MINT = '4jH8AzNS9op6fKNNzxmmagvqpbC2egwHRxBsaUjDfQLk';
const MIN_CLAWDPUMP = 2_000_000;
const PAID_LAUNCH_COST_SOL = parseFloat(process.env.PAID_LAUNCH_COST_SOL || '0.02');

/**
 * Check if a wallet holds at least a certain amount of an SPL token.
 */
export async function checkTokenBalance(walletAddress, tokenMintAddress, minAmount) {
    try {
        const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
        const walletPubkey = new PublicKey(walletAddress);
        const tokenMintPubkey = new PublicKey(tokenMintAddress);

        const tokenAccountAddress = await getAssociatedTokenAddress(
            tokenMintPubkey,
            walletPubkey
        );

        const tokenAccountInfo = await connection.getTokenAccountBalance(tokenAccountAddress);

        if (!tokenAccountInfo || !tokenAccountInfo.value) {
            return { hasBalance: false, balance: 0 };
        }

        const balance = parseFloat(tokenAccountInfo.value.uiAmount || 0);
        return {
            hasBalance: balance >= minAmount,
            balance,
        };
    } catch (error) {
        console.error(`[Balance] Error checking token balance for ${walletAddress}:`, error.message);
        return { hasBalance: false, balance: 0 };
    }
}

/**
 * Check $CLAWDPUMP balance for a wallet.
 */
export async function checkClawdpumpBalance(walletAddress) {
    return await checkTokenBalance(walletAddress, CLAWDPUMP_MINT, MIN_CLAWDPUMP);
}

/**
 * Check SOL balance for a wallet.
 *
 * @param {string} walletAddress
 * @returns {Promise<{ balanceSol: number, hasEnoughForLaunch: boolean }>}
 */
export async function checkSolBalance(walletAddress) {
    try {
        const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
        const walletPubkey = new PublicKey(walletAddress);
        const balanceLamports = await connection.getBalance(walletPubkey);
        const balanceSol = balanceLamports / 1e9;
        // Add buffer for transaction fee (~0.000005 SOL, we use 0.001 to be safe)
        const TX_FEE_BUFFER = 0.001;

        return {
            balanceSol,
            balanceLamports,
            hasEnoughForLaunch: balanceSol >= (PAID_LAUNCH_COST_SOL + TX_FEE_BUFFER),
        };
    } catch (error) {
        console.error(`[Balance] Error checking SOL balance for ${walletAddress}:`, error.message);
        return { balanceSol: 0, balanceLamports: 0, hasEnoughForLaunch: false };
    }
}

/**
 * Determine launch eligibility for an agent wallet.
 *
 * @param {string} walletAddress
 * @returns {Promise<{
 *   eligibility: 'free' | 'paid' | 'cannot',
 *   clawdpumpBalance: number,
 *   solBalance: number,
 *   paidLaunchCost: number,
 *   reason: string
 * }>}
 */
export async function checkLaunchEligibility(walletAddress) {
    // Check $CLAWDPUMP first
    const { hasBalance: hasClawdpump, balance: clawdpumpBalance } = await checkClawdpumpBalance(walletAddress);

    if (hasClawdpump) {
        return {
            eligibility: 'free',
            clawdpumpBalance,
            solBalance: 0,
            paidLaunchCost: PAID_LAUNCH_COST_SOL,
            reason: `Wallet holds ${clawdpumpBalance.toLocaleString()} $CLAWDPUMP (>= ${MIN_CLAWDPUMP.toLocaleString()}) — free launch eligible`,
        };
    }

    // Check SOL balance
    const { balanceSol, hasEnoughForLaunch } = await checkSolBalance(walletAddress);

    if (hasEnoughForLaunch) {
        return {
            eligibility: 'paid',
            clawdpumpBalance,
            solBalance: balanceSol,
            paidLaunchCost: PAID_LAUNCH_COST_SOL,
            reason: `Wallet has ${balanceSol.toFixed(4)} SOL — paid launch eligible (${PAID_LAUNCH_COST_SOL} SOL)`,
        };
    }

    return {
        eligibility: 'cannot',
        clawdpumpBalance,
        solBalance: balanceSol,
        paidLaunchCost: PAID_LAUNCH_COST_SOL,
        reason: 'Insufficient balance for either launch type',
    };
}

/**
 * Get the current paid launch cost in SOL.
 */
export function getPaidLaunchCost() {
    return PAID_LAUNCH_COST_SOL;
}
