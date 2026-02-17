import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

/**
 * Send native SOL
 */
export async function sendSol(fromKeypair, toAddress, amountSol) {
    const toPubkey = new PublicKey(toAddress);
    const lamports = Math.floor(amountSol * 1e9);

    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: fromKeypair.publicKey,
            toPubkey,
            lamports,
        })
    );

    // Retry logic
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const signature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [fromKeypair],
                { commitment: 'confirmed' }
            );

            // Get fee from transaction
            const txDetails = await connection.getTransaction(signature, { commitment: 'confirmed' });
            const fee = txDetails?.meta?.fee || 5000; // Default 5000 lamports if not found

            return {
                signature,
                fee: fee / 1e9,
                explorer: `https://solscan.io/tx/${signature}`,
            };
        } catch (err) {
            console.error(`[SOL Transfer] Attempt ${attempt} failed:`, err.message);
            if (attempt === 3) throw err;
            await new Promise(r => setTimeout(r, 2000 * attempt)); // Exponential backoff
        }
    }
}

/**
 * Send SPL token
 */
export async function sendSplToken(fromKeypair, toAddress, mintAddress, amount) {
    const mintPubkey = new PublicKey(mintAddress);
    const toPubkey = new PublicKey(toAddress);

    // Get associated token accounts
    const fromAta = await getAssociatedTokenAddress(mintPubkey, fromKeypair.publicKey);
    const toAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);

    // Check if recipient ATA exists, if not we need to create it (not implemented here - would add cost)
    // For now, assume it exists or return an error

    const transaction = new Transaction().add(
        createTransferInstruction(
            fromAta,
            toAta,
            fromKeypair.publicKey,
            amount,
            [],
            TOKEN_PROGRAM_ID
        )
    );

    // Retry logic
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const signature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [fromKeypair],
                { commitment: 'confirmed' }
            );

            const txDetails = await connection.getTransaction(signature, { commitment: 'confirmed' });
            const fee = txDetails?.meta?.fee || 5000;

            return {
                signature,
                fee: fee / 1e9,
                explorer: `https://solscan.io/tx/${signature}`,
            };
        } catch (err) {
            console.error(`[SPL Transfer] Attempt ${attempt} failed:`, err.message);
            if (attempt === 3) {
                // Check if it's a "destination account doesn't exist" error
                if (err.message?.includes('could not find account')) {
                    throw new Error('Recipient token account does not exist. Ask recipient to create it first.');
                }
                throw err;
            }
            await new Promise(r => setTimeout(r, 2000 * attempt));
        }
    }
}

/**
 * Get balance (SOL or SPL token)
 */
export async function getBalance(address, mintAddress = null) {
    const pubkey = new PublicKey(address);

    if (!mintAddress || mintAddress === 'SOL') {
        // Get SOL balance
        const lamports = await connection.getBalance(pubkey);
        return lamports / 1e9;
    }

    // Get SPL token balance
    const mintPubkey = new PublicKey(mintAddress);
    const ata = await getAssociatedTokenAddress(mintPubkey, pubkey);

    try {
        const balance = await connection.getTokenAccountBalance(ata);
        return parseFloat(balance.value.uiAmount || 0);
    } catch (err) {
        // Account doesn't exist = 0 balance
        return 0;
    }
}
