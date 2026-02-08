/**
 * pump.fun integration via official @pump-fun/pump-sdk
 *
 * Two modes:
 *   SIMULATE=true  → returns realistic fake data (default for local dev)
 *   SIMULATE=false → creates real tokens on-chain via official Pump SDK
 *
 * Architecture:
 *   - Platform wallet (PLATFORM_PRIVATE_KEY) signs and pays all gas
 *   - Agents never need keys — just call the API
 *   - Uses devnet by default (SOLANA_RPC_URL), switch to mainnet for production
 */

const SIMULATE = process.env.SIMULATE !== 'false';
const PLATFORM_PRIVATE_KEY = process.env.PLATFORM_PRIVATE_KEY || '';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a realistic-looking Solana base58 address */
function fakeSolanaAddress() {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let addr = '';
    for (let i = 0; i < 44; i++) addr += chars[Math.floor(Math.random() * chars.length)];
    return addr;
}

/** Generate a realistic-looking Solana transaction signature */
function fakeTxSignature() {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let sig = '';
    for (let i = 0; i < 88; i++) sig += chars[Math.floor(Math.random() * chars.length)];
    return sig;
}

/** Generate a minimal 1x1 PNG placeholder image as a Buffer */
function generatePlaceholderPng() {
    const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+hc2rNAAAAABJRU5ErkJggg==';
    return Buffer.from(base64Png, 'base64');
}

/**
 * Load platform keypair from PLATFORM_PRIVATE_KEY env var.
 * Supports base58-encoded secret key.
 */
async function loadPlatformKeypair() {
    if (!PLATFORM_PRIVATE_KEY) {
        throw new Error('PLATFORM_PRIVATE_KEY is required when SIMULATE=false. Set it in .env.local');
    }

    const { Keypair } = await import('@solana/web3.js');
    const bs58 = (await import('bs58')).default;

    try {
        const secretKey = bs58.decode(PLATFORM_PRIVATE_KEY);
        return Keypair.fromSecretKey(secretKey);
    } catch (e) {
        throw new Error(`Failed to decode PLATFORM_PRIVATE_KEY: ${e.message}. Must be base58-encoded.`);
    }
}

// ---------------------------------------------------------------------------
// Token Creation
// ---------------------------------------------------------------------------

/**
 * Create a token on pump.fun.
 *
 * @param {object} opts
 * @param {string} opts.name        Token name
 * @param {string} opts.symbol      Token symbol
 * @param {string} opts.description Token description
 * @param {string} [opts.agentWallet] Agent's Solana wallet — for 70/30 fee split
 * @param {string} [opts.imageUrl]  Direct image URL (optional)
 * @param {string} [opts.website]   Optional website
 * @param {string} [opts.twitter]   Optional twitter
 * @param {string} [opts.telegram]  Optional telegram
 * @returns {Promise<{mintAddress: string, txSignature: string, pumpUrl: string, explorerUrl: string, simulated: boolean}>}
 */
export async function createToken(opts) {
    if (SIMULATE) {
        return simulateCreateToken(opts);
    }
    return realCreateToken(opts);
}

/**
 * Simulation mode — returns fake but realistic data.
 */
async function simulateCreateToken(opts) {
    await new Promise(r => setTimeout(r, 500));

    const mintAddress = fakeSolanaAddress();
    const txSignature = fakeTxSignature();

    console.log(`[SIMULATE] Token created: ${opts.name} (${opts.symbol})`);
    console.log(`[SIMULATE] Mint: ${mintAddress}`);
    console.log(`[SIMULATE] Tx:   ${txSignature}`);

    return {
        mintAddress,
        txSignature,
        pumpUrl: `https://pump.fun/coin/${mintAddress}`,
        explorerUrl: `https://solscan.io/tx/${txSignature}`,
        simulated: true,
    };
}

/**
 * Real mode — creates token on pump.fun using official SDK.
 *
 * Flow:
 *   1. Upload metadata to pump.fun IPFS (name, symbol, description, image)
 *   2. Generate mint keypair
 *   3. Build create instruction via PumpSdk
 *   4. Platform wallet signs & sends the transaction
 */
async function realCreateToken(opts) {
    const { Connection, Keypair, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
    const { PumpSdk } = await import('@pump-fun/pump-sdk');

    // Load platform keypair (creator + payer)
    // pump.fun requires creator == user (signer)
    // Fee sharing will be set up separately to split 70/30
    const platformKeypair = await loadPlatformKeypair();
    console.log('[REAL] Platform wallet:', platformKeypair.publicKey.toBase58());

    // Connect to Solana
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

    // Check platform wallet balance
    const balance = await connection.getBalance(platformKeypair.publicKey);
    const balanceSol = balance / 1e9;
    console.log('[REAL] Platform balance:', balanceSol, 'SOL');
    if (balanceSol < 0.01) {
        throw new Error(`Insufficient SOL balance (${balanceSol} SOL). Need at least 0.01 SOL for token creation. Fund: ${platformKeypair.publicKey.toBase58()}`);
    }

    // Step 1: Upload metadata to pump.fun IPFS
    console.log('[REAL] Uploading metadata to pump.fun IPFS...');
    const formData = new FormData();
    formData.append('name', opts.name);
    formData.append('symbol', opts.symbol);
    formData.append('description', opts.description || `${opts.name} — launched via ClawDotPump`);
    formData.append('showName', 'true');
    if (opts.website) formData.append('website', opts.website);
    if (opts.twitter) formData.append('twitter', opts.twitter);
    if (opts.telegram) formData.append('telegram', opts.telegram);

    // Attach image
    let imageAttached = false;
    if (opts.imageUrl) {
        try {
            console.log('[REAL] Fetching image from:', opts.imageUrl);
            const imgResp = await fetch(opts.imageUrl);
            if (imgResp.ok) {
                const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                const ext = opts.imageUrl.split('.').pop()?.split('?')[0] || 'png';
                const blob = new Blob([imgBuffer], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
                formData.append('file', blob, `token-logo.${ext}`);
                imageAttached = true;
                console.log('[REAL] Image attached:', imgBuffer.length, 'bytes');
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

    const ipfsResp = await fetch('https://pump.fun/api/ipfs', {
        method: 'POST',
        body: formData,
    });

    if (!ipfsResp.ok) {
        const errText = await ipfsResp.text();
        console.error('[REAL] IPFS upload failed:', ipfsResp.status, errText);
        throw new Error(`IPFS upload failed: ${ipfsResp.status} ${errText}`);
    }

    const ipfsData = await ipfsResp.json();
    const metadataUri = ipfsData.metadataUri;
    console.log('[REAL] Metadata URI:', metadataUri);

    // Step 2: Generate mint keypair
    const mintKeypair = Keypair.generate();
    console.log('[REAL] Mint address:', mintKeypair.publicKey.toBase58());

    // Step 3: Build create instruction via official Pump SDK
    const sdk = new PumpSdk(connection);

    const createIx = await sdk.createInstruction({
        mint: mintKeypair.publicKey,
        name: opts.name,
        symbol: opts.symbol,
        uri: metadataUri,
        creator: platformKeypair.publicKey,  // Must be signer (fee sharing configured separately)
        user: platformKeypair.publicKey,     // Payer
    });

    // Step 4: Build, sign, and send transaction
    console.log('[REAL] Sending transaction...');

    const tx = new Transaction();
    tx.add(createIx);

    const txSignature = await sendAndConfirmTransaction(
        connection,
        tx,
        [platformKeypair, mintKeypair],  // Platform signs as payer, mint signs as new account
        { commitment: 'confirmed' }
    );

    console.log('[REAL] Token created!');
    console.log('[REAL] Mint:', mintKeypair.publicKey.toBase58());
    console.log('[REAL] Tx:', txSignature);

    // Step 5: Set up fee sharing (70% agent / 30% platform)
    let feeSharingStatus = 'pending';
    let feeSharingTx = null;

    if (opts.agentWallet) {
        // Wait for mint account to be fully initialized on-chain
        console.log('[REAL] Waiting for mint account to finalize...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        const { PublicKey: PK } = await import('@solana/web3.js');
        const agentPubkey = new PK(opts.agentWallet);

        // Retry fee sharing setup (mint may need extra time to propagate)
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[REAL] Setting up fee sharing (70/30) — attempt ${attempt}/3...`);

                const createConfigIx = await sdk.createFeeSharingConfig({
                    creator: platformKeypair.publicKey,
                    mint: mintKeypair.publicKey,
                    pool: null,
                });

                const updateSharesIx = await sdk.updateFeeShares({
                    authority: platformKeypair.publicKey,
                    mint: mintKeypair.publicKey,
                    currentShareholders: [platformKeypair.publicKey],
                    newShareholders: [
                        { address: agentPubkey, shareBps: 7000 },
                        { address: platformKeypair.publicKey, shareBps: 3000 },
                    ],
                });

                const feeTx = new Transaction();
                feeTx.add(createConfigIx, updateSharesIx);

                const feeTxSig = await sendAndConfirmTransaction(
                    connection,
                    feeTx,
                    [platformKeypair],
                    { commitment: 'confirmed' }
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
                    console.error('[REAL] Fee sharing failed after 3 attempts. Token launched but fees not configured.');
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
// Fee Claiming
// ---------------------------------------------------------------------------

/**
 * Claim accumulated creator fees for all tokens created by the platform wallet.
 *
 * @returns {Promise<{txSignature: string, simulated: boolean}>}
 */
export async function claimFees() {
    if (SIMULATE) {
        await new Promise(r => setTimeout(r, 300));
        const txSignature = fakeTxSignature();
        console.log('[SIMULATE] Fees claimed');
        return { txSignature, simulated: true };
    }

    const { Connection, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
    const { OnlinePumpSdk } = await import('@pump-fun/pump-sdk');

    const platformKeypair = await loadPlatformKeypair();
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const onlineSdk = new OnlinePumpSdk(connection);

    // Get creator vault balance
    const balance = await onlineSdk.getCreatorVaultBalanceBothPrograms(platformKeypair.publicKey);
    console.log('[REAL] Creator vault balance:', balance.toString(), 'lamports');

    if (balance.isZero()) {
        return { txSignature: null, simulated: false, message: 'No fees to claim' };
    }

    // Build claim instructions
    const instructions = await onlineSdk.collectCoinCreatorFeeInstructions(platformKeypair.publicKey);

    const tx = new Transaction();
    instructions.forEach(ix => tx.add(ix));

    const txSignature = await sendAndConfirmTransaction(
        connection,
        tx,
        [platformKeypair],
        { commitment: 'confirmed' }
    );

    console.log('[REAL] Fees claimed! Tx:', txSignature);
    return { txSignature, simulated: false };
}

// ---------------------------------------------------------------------------
// Balance Check
// ---------------------------------------------------------------------------

/**
 * Check platform wallet balance and creator fee balance.
 *
 * @returns {Promise<{walletAddress: string, balanceSol: number, creatorFeesLamports: string, simulated: boolean}>}
 */
export async function checkPlatformBalance() {
    if (SIMULATE) {
        return {
            walletAddress: fakeSolanaAddress(),
            balanceSol: 1.5,
            creatorFeesLamports: '0',
            simulated: true,
        };
    }

    const { Connection } = await import('@solana/web3.js');
    const { OnlinePumpSdk } = await import('@pump-fun/pump-sdk');

    const platformKeypair = await loadPlatformKeypair();
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

    const balance = await connection.getBalance(platformKeypair.publicKey);
    const onlineSdk = new OnlinePumpSdk(connection);

    let creatorFees = '0';
    try {
        const fees = await onlineSdk.getCreatorVaultBalanceBothPrograms(platformKeypair.publicKey);
        creatorFees = fees.toString();
    } catch (e) {
        console.error('[REAL] Fee check failed (may be no tokens yet):', e.message);
    }

    return {
        walletAddress: platformKeypair.publicKey.toBase58(),
        balanceSol: balance / 1e9,
        creatorFeesLamports: creatorFees,
        simulated: false,
    };
}
