/**
 * Solana token balance checker
 * Checks if a wallet holds a minimum amount of a specific SPL token
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * Check if a wallet holds at least a certain amount of an SPL token
 * @param {string} walletAddress - Wallet address to check
 * @param {string} tokenMintAddress - Token mint address
 * @param {number} minAmount - Minimum amount required (in token units, not lamports)
 * @returns {Promise<{hasBalance: boolean, balance: number}>}
 */
export async function checkTokenBalance(walletAddress, tokenMintAddress, minAmount) {
    try {
        const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

        const walletPubkey = new PublicKey(walletAddress);
        const tokenMintPubkey = new PublicKey(tokenMintAddress);

        // Get the associated token account address
        const tokenAccountAddress = await getAssociatedTokenAddress(
            tokenMintPubkey,
            walletPubkey
        );

        // Fetch token account info
        const tokenAccountInfo = await connection.getTokenAccountBalance(tokenAccountAddress);

        if (!tokenAccountInfo || !tokenAccountInfo.value) {
            return { hasBalance: false, balance: 0 };
        }

        // Parse balance (comes as string with decimals considered)
        const balance = parseFloat(tokenAccountInfo.value.uiAmount || 0);

        return {
            hasBalance: balance >= minAmount,
            balance: balance
        };

    } catch (error) {
        // If account doesn't exist or any other error, assume no balance
        console.error(`[Token Balance Check] Error checking balance for ${walletAddress}:`, error.message);
        return { hasBalance: false, balance: 0 };
    }
}

/**
 * Check if wallet holds minimum $CLAWDPUMP tokens
 * @param {string} walletAddress - Wallet to check
 * @returns {Promise<{hasBalance: boolean, balance: number}>}
 */
export async function checkClawdpumpBalance(walletAddress) {
    const CLAWDPUMP_MINT = '4jH8AzNS9op6fKNNzxmmagvqpbC2egwHRxBsaUjDfQLk';
    const MIN_BALANCE = 2_000_000; // 2M $CLAWDPUMP

    return await checkTokenBalance(walletAddress, CLAWDPUMP_MINT, MIN_BALANCE);
}

/**
 * Check if wallet is whitelisted (can bypass token holding requirement)
 * Whitelist is defined in LAUNCH_WHITELIST env var as comma-separated addresses
 * @param {string} walletAddress - Wallet to check
 * @returns {boolean}
 */
export function isWhitelisted(walletAddress) {
    const whitelist = (process.env.LAUNCH_WHITELIST || '').split(',').map(w => w.trim()).filter(Boolean);
    return whitelist.includes(walletAddress);
}

/**
 * Check if agent can launch tokens (either has balance or is whitelisted)
 * @param {string} walletAddress - Agent's wallet address
 * @returns {Promise<{canLaunch: boolean, reason: string, balance: number}>}
 */
export async function canAgentLaunch(walletAddress) {
    // Check whitelist first (faster)
    if (isWhitelisted(walletAddress)) {
        return {
            canLaunch: true,
            reason: 'whitelisted',
            balance: 0
        };
    }

    // Check $CLAWDPUMP balance
    const { hasBalance, balance } = await checkClawdpumpBalance(walletAddress);

    if (hasBalance) {
        return {
            canLaunch: true,
            reason: 'sufficient_balance',
            balance: balance
        };
    }

    return {
        canLaunch: false,
        reason: 'insufficient_balance',
        balance: balance
    };
}
