/**
 * Input sanitization utilities for ClawDotPump.
 * Prevents XSS, injection, and ensures data integrity.
 */

import crypto from 'crypto';

/**
 * Strip HTML tags from a string.
 */
export function stripHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/<[^>]*>/g, '').trim();
}

/**
 * Sanitize a text field: strip HTML, limit length, trim.
 */
export function sanitizeText(str, maxLength = 500) {
    if (typeof str !== 'string') return '';
    return stripHtml(str).slice(0, maxLength).trim();
}

/**
 * Validate a Solana base58 address (32-44 chars, base58 charset).
 */
export function isValidSolanaAddress(addr) {
    if (typeof addr !== 'string') return false;
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/**
 * Validate agentId format (alphanumeric + hyphens + underscores, 3-50 chars).
 */
export function isValidAgentId(id) {
    if (typeof id !== 'string') return false;
    return /^[a-zA-Z0-9_-]{3,50}$/.test(id);
}

/**
 * Hash an API key using SHA-256. One-way — cannot be reversed.
 */
export function hashApiKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Generate a cryptographically secure API key.
 */
export function generateApiKey() {
    return `cpump_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Sanitize a URL (basic validation).
 */
export function sanitizeUrl(url) {
    if (typeof url !== 'string') return null;
    url = url.trim();
    if (!url) return null;
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        return parsed.href;
    } catch {
        return null;
    }
}

/**
 * Sanitize a Twitter handle.
 */
export function sanitizeTwitter(handle) {
    if (typeof handle !== 'string') return null;
    handle = handle.trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(handle)) return null;
    return `@${handle}`;
}

/**
 * Sanitize a token symbol.
 */
export function sanitizeSymbol(symbol) {
    if (typeof symbol !== 'string') return '';
    return symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
}
