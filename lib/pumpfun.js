/**
 * pump.fun integration via official @pump-fun/pump-sdk — v2
 *
 * Dual treasury architecture:
 *   FREE_TREASURY (PLATFORM_PRIVATE_KEY):
 *     - Deploys free tokens (agents holding 2M+ $CLAWDPUMP)
 *     - Receives 30% creator fees
 *     - Fee sharing: 70% agent / 30% treasury
 *
 *   PAID_TREASURY (PAID_TREASURY_PRIVATE_KEY):
 *     - Receives SOL payment from agent wallet (0.02 SOL default)
 *     - Deploys paid tokens
 *     - Receives 15% creator fees
 *     - Fee sharing: 85% agent / 15% treasury
 *
 * Agent wallets are system-managed. The platform signs transactions
 * on behalf of agents using their encrypted private keys.
 *
 * Two modes:
 *   SIMULATE=true  → returns realistic fake data (local dev)
 *   SIMULATE=false → creates real tokens on-chain
 */

const SIMULATE = process.env.SIMULATE !== 'false';
const PLATFORM_PRIVATE_KEY = process.env.PLATFORM_PRIVATE_KEY || '';
const PAID_TREASURY_PRIVATE_KEY = process.env.PAID_TREASURY_PRIVATE_KEY || '';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PAID_LAUNCH_COST_SOL = parseFloat(process.env.PAID_LAUNCH_COST_SOL || '0.02');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeSolanaAddress() {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let addr = '';
    for (let i = 0; i < 44; i++) addr += chars[Math.floor(Math.random() * chars.length)];
    return addr;
}

function fakeTxSignature() {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let sig = '';
    for (let i = 0; i < 88; i++) sig += chars[Math.floor(Math.random() * chars.length)];
    return sig;
}

function generatePlaceholderPng() {
    const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+hc2rNAAAAABJRU5ErkJggg==';
    return Buffer.from(base64Png, 'base64');
}

/**
 * Load a keypair from a base58-encoded private key string.
 */
async function loadKeypairFromBase58(base58Key, label = 'wallet') {
    if (!base58Key) {
        throw new Error(`${label} private key is not configured`);
    }
    const { Keypair } = await import('@solana/web3.js');
    const bs58 = (await import('bs58')).default;
    try {
        const secretKey = bs58.decode(base58Key);
        return Keypair.fromSecretKey(secretKey);
    } catch (e) {
        throw new Error(`Failed to decode ${label} private key: ${e.message}`);
    }
}

/**
 * Load the free treasury keypair (PLATFORM_PRIVATE_KEY).
 */
async function loadFreeTreasuryKeypair() {
    return loadKeypairFromBase58(PLATFORM_PRIVATE_KEY, 'Free treasury (PLATFORM_PRIVATE_KEY)');
}

/**
 * Load the paid treasury keypair (PAID_TREASURY_PRIVATE_KEY).
 */
async function loadPaidTreasuryKeypair() {
    return loadKeypairFromBase58(PAID_TREASURY_PRIVATE_KEY, 'Paid treasury (PAID_TREASURY_PRIVATE_KEY)');
}

// ---------------------------------------------------------------------------
// Token Creation — Dual Treasury
// ---------------------------------------------------------------------------

/**
 * Create a token on pump.fun.
 *
 * @param {object} opts
 * @param {string} opts.name          Token name
 * @param {string} opts.symbol        Token symbol
 * @param {string} opts.description   Token description
 * @param {string} opts.launchType    'free' or 'paid'
 * @param {string} opts.agentWallet   Agent's wallet address (for fee sharing)
 * @param {import('@solana/web3.js').Keypair} [opts.agentKeypair] Agent's keypair (for paid — SOL transfer)
 * @param {string} [opts.imageUrl]    Direct image URL
 * @param {Buffer} [opts.imageBuffer] Raw image buffer (from multipart upload)
 * @param {string} [opts.imageMime]   MIME type of image buffer
 * @param {string} [opts.website]     Optional website
 * @param {string} [opts.twitter]     Optional twitter
 * @param {string} [opts.telegram]    Optional telegram
 */
export async function createToken(opts) {
    if (SIMULATE) return simulateCreateToken(opts);
    return realCreateToken(opts);
}

async function simulateCreateToken(opts) {
    await new Promise(r => setTimeout(r, 500));
    const mintAddress = fakeSolanaAddress();
    const txSignature = fakeTxSignature();

    console.log(`[SIMULATE] Token created: ${opts.name} (${opts.symbol}) — ${opts.launchType} launch`);
    console.log(`[SIMULATE] Mint: ${mintAddress}`);

    return {
        mintAddress,
        txSignature,
        pumpUrl: `https://pump.fun/coin/${mintAddress}`,
        explorerUrl: `https://solscan.io/tx/${txSignature}`,
        simulated: true,
        feeSharingStatus: 'simulated',
        feeSharingTx: null,
    };
}

/**
 * Real token creation via pump.fun SDK.
 *
 * Flow:
 *   1. Select treasury based on launchType
 *   2. For paid: transfer SOL from agent → paid treasury
 *   3. Upload metadata to IPFS
 *   4. Treasury creates token (treasury is the on-chain creator)
 *   5. Set up fee sharing with agent wallet
 */
async function realCreateToken(opts) {
    const { Connection, Keypair, Transaction, SystemProgram,
        sendAndConfirmTransaction, PublicKey: PK } = await import('@solana/web3.js');
    const { PumpSdk } = await import('@pump-fun/pump-sdk');

    const launchType = opts.launchType || 'free';
    const isPaid = launchType === 'paid';

    // Select correct treasury
    const treasuryKeypair = isPaid
        ? await loadPaidTreasuryKeypair()
        : await loadFreeTreasuryKeypair();

    console.log(`[REAL] ${isPaid ? 'Paid' : 'Free'} treasury: ${treasuryKeypair.publicKey.toBase58()}`);

    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

    // --- For paid launches: transfer SOL from agent → paid treasury ---
    if (isPaid && opts.agentKeypair) {
        const costLamports = Math.ceil(PAID_LAUNCH_COST_SOL * 1e9);
        console.log(`[REAL] Transferring ${PAID_LAUNCH_COST_SOL} SOL from agent to paid treasury...`);

        const transferTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: opts.agentKeypair.publicKey,
                toPubkey: treasuryKeypair.publicKey,
                lamports: costLamports,
            })
        );

        const transferSig = await sendAndConfirmTransaction(
            connection, transferTx, [opts.agentKeypair], { commitment: 'confirmed' }
        );
        console.log(`[REAL] SOL transfer complete: ${transferSig}`);
    }

    // Check treasury balance
    const balance = await connection.getBalance(treasuryKeypair.publicKey);
    const balanceSol = balance / 1e9;
    console.log(`[REAL] Treasury balance: ${balanceSol} SOL`);
    if (balanceSol < 0.01) {
        throw new Error(`Insufficient treasury SOL (${balanceSol}). Need >= 0.01 SOL. Fund: ${treasuryKeypair.publicKey.toBase58()}`);
    }

    // --- Upload metadata to IPFS ---
    console.log('[REAL] Uploading metadata to pump.fun IPFS...');
    const formData = new FormData();
    formData.append('name', opts.name);
    formData.append('symbol', opts.symbol);
    formData.append('description', opts.description || `${opts.name} — launched via ClawdPump`);
    formData.append('showName', 'true');
    if (opts.website) formData.append('website', opts.website);
    if (opts.twitter) formData.append('twitter', opts.twitter);
    if (opts.telegram) formData.append('telegram', opts.telegram);

    // Attach image — support buffer (multipart), URL, or placeholder
    let imageAttached = false;

    if (opts.imageBuffer) {
        const blob = new Blob([opts.imageBuffer], { type: opts.imageMime || 'image/png' });
        const ext = (opts.imageMime || 'image/png').split('/')[1] || 'png';
        formData.append('file', blob, `token-logo.${ext}`);
        imageAttached = true;
        console.log(`[REAL] Image attached from buffer: ${opts.imageBuffer.length} bytes`);
    } else if (opts.imageUrl) {
        try {
            console.log('[REAL] Fetching image from:', opts.imageUrl);
            const imgResp = await fetch(opts.imageUrl);
            if (imgResp.ok) {
                const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                const ext = opts.imageUrl.split('.').pop()?.split('?')[0] || 'png';
                const blob = new Blob([imgBuffer], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
                formData.append('file', blob, `token-logo.${ext}`);
                imageAttached = true;
                console.log(`[REAL] Image attached: ${imgBuffer.length} bytes`);
            }
        } catch (e) {
            console.error('[REAL] Image fetch failed:', e.message);
        }
    }

    if (!imageAttached) {
        console.log('[REAL] Using placeholder image');
        const placeholder = generatePlaceholderPng();
        const blob = new Blob([placeholder], { type: 'image/png' });
        formData.append('file', blob, 'token-logo.png');
    }

    const ipfsResp = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: formData });
    if (!ipfsResp.ok) {
        const errText = await ipfsResp.text();
        throw new Error(`IPFS upload failed: ${ipfsResp.status} ${errText}`);
    }

    const ipfsData = await ipfsResp.json();
    const metadataUri = ipfsData.metadataUri;
    console.log('[REAL] Metadata URI:', metadataUri);

    // --- Generate mint keypair ---
    const mintKeypair = Keypair.generate();
    console.log('[REAL] Mint address:', mintKeypair.publicKey.toBase58());

    // --- Create token via SDK (treasury is creator + payer) ---
    const sdk = new PumpSdk(connection);

    const createIx = await sdk.createInstruction({
        mint: mintKeypair.publicKey,
        name: opts.name,
        symbol: opts.symbol,
        uri: metadataUri,
        creator: treasuryKeypair.publicKey,
        user: treasuryKeypair.publicKey,
    });

    console.log('[REAL] Sending create transaction...');
    const tx = new Transaction();
    tx.add(createIx);

    const txSignature = await sendAndConfirmTransaction(
        connection, tx, [treasuryKeypair, mintKeypair], { commitment: 'confirmed' }
    );

    console.log('[REAL] Token created! Mint:', mintKeypair.publicKey.toBase58(), 'Tx:', txSignature);

    // --- Set up fee sharing ---
    let feeSharingStatus = 'pending';
    let feeSharingTx = null;

    if (opts.agentWallet) {
        console.log('[REAL] Waiting for mint to finalize...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        const agentPubkey = new PK(opts.agentWallet);
        const shareBps = isPaid ? 8500 : 7000;        // 85% or 70% to agent
        const platformBps = isPaid ? 1500 : 3000;     // 15% or 30% to treasury

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[REAL] Setting up fee sharing (${shareBps / 100}/${platformBps / 100}) — attempt ${attempt}/3...`);

                const createConfigIx = await sdk.createFeeSharingConfig({
                    creator: treasuryKeypair.publicKey,
                    mint: mintKeypair.publicKey,
                    pool: null,
                });

                const updateSharesIx = await sdk.updateFeeShares({
                    authority: treasuryKeypair.publicKey,
                    mint: mintKeypair.publicKey,
                    currentShareholders: [treasuryKeypair.publicKey],
                    newShareholders: [
                        { address: agentPubkey, shareBps },
                        { address: treasuryKeypair.publicKey, shareBps: platformBps },
                    ],
                });

                const feeTx = new Transaction();
                feeTx.add(createConfigIx, updateSharesIx);

                const feeTxSig = await sendAndConfirmTransaction(
                    connection, feeTx, [treasuryKeypair], { commitment: 'confirmed' }
                );

                console.log('[REAL] Fee sharing configured! Tx:', feeTxSig);
                feeSharingStatus = 'configured';
                feeSharingTx = feeTxSig;
                break;
            } catch (feeErr) {
                console.error(`[REAL] Fee sharing attempt ${attempt} failed:`, feeErr.message);
                if (attempt < 3) {
                    const delay = attempt * 5000;
                    console.log(`[REAL] Retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    feeSharingStatus = 'failed';
                    console.error('[REAL] Fee sharing failed after 3 attempts.');
                }
            }
        }
    }

    return {
        mintAddress: mintKeypair.publicKey.toBase58(),
        txSignature,
        pumpUrl: `https://pump.fun/coin/${mintKeypair.publicKey.toBase58()}`,
        explorerUrl: `https://solscan.io/tx/${txSignature}`,
        simulated: false,
        feeSharingStatus,
        feeSharingTx,
    };
}

// ---------------------------------------------------------------------------
// Fee Claiming — for agent wallets
// ---------------------------------------------------------------------------

/**
 * Claim creator fees for a specific agent wallet.
 * Uses the agent's encrypted keypair to sign the claim transaction.
 *
 * @param {import('@solana/web3.js').Keypair} agentKeypair - Agent's decrypted keypair
 * @returns {Promise<{ txSignature: string|null, amountLamports: number, simulated: boolean }>}
 */
export async function claimAgentFees(agentKeypair) {
    if (SIMULATE) {
        await new Promise(r => setTimeout(r, 300));
        return { txSignature: fakeTxSignature(), amountLamports: 50000000, simulated: true };
    }

    const { Connection, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
    const { OnlinePumpSdk } = await import('@pump-fun/pump-sdk');

    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const onlineSdk = new OnlinePumpSdk(connection);

    // Check claimable balance
    const balance = await onlineSdk.getCreatorVaultBalanceBothPrograms(agentKeypair.publicKey);
    console.log(`[CLAIM] Creator vault balance for ${agentKeypair.publicKey.toBase58()}: ${balance.toString()} lamports`);

    if (balance.isZero()) {
        return { txSignature: null, amountLamports: 0, simulated: false, message: 'No fees to claim' };
    }

    // Build and send claim instructions
    const instructions = await onlineSdk.collectCoinCreatorFeeInstructions(agentKeypair.publicKey);

    const tx = new Transaction();
    instructions.forEach(ix => tx.add(ix));

    const txSignature = await sendAndConfirmTransaction(
        connection, tx, [agentKeypair], { commitment: 'confirmed' }
    );

    console.log(`[CLAIM] Fees claimed! Tx: ${txSignature}`);
    return { txSignature, amountLamports: parseInt(balance.toString()), simulated: false };
}

/**
 * Check claimable fee balance for an agent wallet (read-only).
 *
 * @param {string} walletAddress
 * @returns {Promise<{ balanceLamports: number, balanceSol: number }>}
 */
export async function getAgentFeeBalance(walletAddress) {
    if (SIMULATE) {
        return { balanceLamports: 50000000, balanceSol: 0.05 };
    }

    try {
        const { Connection, PublicKey: PK } = await import('@solana/web3.js');
        const { OnlinePumpSdk } = await import('@pump-fun/pump-sdk');

        const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
        const onlineSdk = new OnlinePumpSdk(connection);
        const pubkey = new PK(walletAddress);

        const balance = await onlineSdk.getCreatorVaultBalanceBothPrograms(pubkey);
        const lamports = parseInt(balance.toString());

        return {
            balanceLamports: lamports,
            balanceSol: lamports / 1e9,
        };
    } catch (error) {
        console.error('[FEE CHECK] Error:', error.message);
        return { balanceLamports: 0, balanceSol: 0 };
    }
}

// ---------------------------------------------------------------------------
// Balance Check — Platform/Treasury
// ---------------------------------------------------------------------------

/**
 * Check treasury wallet balances and creator fee balances.
 */
export async function checkTreasuryBalances() {
    if (SIMULATE) {
        return {
            free: { walletAddress: fakeSolanaAddress(), balanceSol: 2.0 },
            paid: { walletAddress: fakeSolanaAddress(), balanceSol: 1.5 },
            simulated: true,
        };
    }

    const { Connection } = await import('@solana/web3.js');

    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

    const freeKeypair = await loadFreeTreasuryKeypair();
    const freeBalance = await connection.getBalance(freeKeypair.publicKey);

    let paidBalance = 0;
    let paidAddress = 'not configured';
    try {
        const paidKeypair = await loadPaidTreasuryKeypair();
        paidBalance = await connection.getBalance(paidKeypair.publicKey);
        paidAddress = paidKeypair.publicKey.toBase58();
    } catch (e) {
        console.error('[TREASURY] Paid treasury not configured:', e.message);
    }

    return {
        free: {
            walletAddress: freeKeypair.publicKey.toBase58(),
            balanceSol: freeBalance / 1e9,
        },
        paid: {
            walletAddress: paidAddress,
            balanceSol: paidBalance / 1e9,
        },
        simulated: false,
    };
}
