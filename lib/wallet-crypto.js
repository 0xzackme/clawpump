/**
 * Secure wallet generation and private key encryption.
 *
 * Uses AES-256-GCM for authenticated encryption of Solana private keys.
 * Each wallet gets a unique IV. The encryption key comes from WALLET_ENCRYPTION_KEY env var.
 *
 * Security model:
 *   - Private keys are NEVER stored in plaintext
 *   - Each encryption uses a random 12-byte IV
 *   - AES-256-GCM provides both confidentiality and integrity (auth tag)
 *   - Encryption key is 32 bytes (64 hex chars) from env var
 *   - Admin can decrypt via dedicated endpoint
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;        // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16;  // 128-bit auth tag

/**
 * Get the encryption key from environment variable.
 * Must be exactly 32 bytes (64 hex characters).
 */
function getEncryptionKey() {
    const keyHex = process.env.WALLET_ENCRYPTION_KEY;
    if (!keyHex) {
        throw new Error('WALLET_ENCRYPTION_KEY env var is required. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    if (keyHex.length !== 64) {
        throw new Error('WALLET_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
    }
    return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a Solana private key (secret key bytes).
 *
 * @param {Uint8Array|Buffer} secretKeyBytes - 64-byte Solana secret key
 * @returns {{ encrypted: string, iv: string, authTag: string }} hex-encoded values
 */
export function encryptPrivateKey(secretKeyBytes) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
        cipher.update(Buffer.from(secretKeyBytes)),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return {
        encrypted: encrypted.toString('hex'),
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
    };
}

/**
 * Decrypt a Solana private key.
 *
 * @param {string} encryptedHex - hex-encoded ciphertext
 * @param {string} ivHex - hex-encoded IV
 * @param {string} authTagHex - hex-encoded auth tag
 * @returns {Uint8Array} 64-byte Solana secret key
 */
export function decryptPrivateKey(encryptedHex, ivHex, authTagHex) {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
    ]);

    return new Uint8Array(decrypted);
}

/**
 * Generate a new Solana keypair and encrypt the private key.
 *
 * @returns {Promise<{ publicKey: string, encrypted: string, iv: string, authTag: string }>}
 */
export async function generateAgentWallet() {
    const { Keypair } = await import('@solana/web3.js');

    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const { encrypted, iv, authTag } = encryptPrivateKey(keypair.secretKey);

    return {
        publicKey,
        encrypted,
        iv,
        authTag,
    };
}

/**
 * Load a Solana Keypair from encrypted storage.
 *
 * @param {{ encrypted_key: string, iv: string, auth_tag: string }} walletRow - DB row from agent_wallets
 * @returns {Promise<import('@solana/web3.js').Keypair>}
 */
export async function loadKeypairFromEncrypted(walletRow) {
    const { Keypair } = await import('@solana/web3.js');

    const secretKey = decryptPrivateKey(
        walletRow.encrypted_key,
        walletRow.iv,
        walletRow.auth_tag
    );

    return Keypair.fromSecretKey(secretKey);
}
