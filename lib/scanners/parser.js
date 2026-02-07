/**
 * !clawdotpump post parser.
 * 
 * Extracts token launch details from both key:value and JSON formats.
 * Used by all platform scanners.
 */

/**
 * Parse a post body for !clawdotpump launch details.
 * 
 * Supports:
 *   - key: value format (one field per line)
 *   - JSON format (in or out of code block)
 * 
 * @param {string} content - The post content
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
export function parseClawdotpumpPost(content) {
    if (!content || typeof content !== 'string') {
        return { success: false, error: 'Empty or invalid content' };
    }

    // Must contain trigger
    if (!content.toLowerCase().includes('!clawdotpump')) {
        return { success: false, error: 'Missing !clawdotpump trigger' };
    }

    // Try JSON first (from code block or raw)
    const jsonData = tryParseJson(content);
    if (jsonData) {
        return validateFields(jsonData);
    }

    // Try key:value format
    const kvData = tryParseKeyValue(content);
    if (kvData) {
        return validateFields(kvData);
    }

    return { success: false, error: 'Could not parse token details. Use key: value or JSON format.' };
}

/**
 * Try to extract JSON from the content (from code block or raw).
 */
function tryParseJson(content) {
    // Try code block first: ```json ... ``` or ``` ... ```
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1].trim());
        } catch { /* not valid JSON in code block */ }
    }

    // Try to find raw JSON object
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch { /* not valid JSON */ }
    }

    return null;
}

/**
 * Try to parse key:value format.
 */
function tryParseKeyValue(content) {
    const lines = content.split('\n');
    const data = {};

    // Field aliases (matching clawnch behavior)
    const aliases = {
        name: ['name', 'token', 'token_name'],
        symbol: ['symbol', 'ticker'],
        wallet: ['wallet', 'address', 'recipient'],
        description: ['description', 'desc', 'about', 'bio'],
        image: ['image', 'img', 'logo', 'icon'],
        website: ['website', 'site', 'url', 'link', 'homepage'],
        twitter: ['twitter', 'x', 'social'],
    };

    // Build reverse lookup
    const aliasMap = {};
    for (const [canonical, names] of Object.entries(aliases)) {
        for (const name of names) {
            aliasMap[name.toLowerCase()] = canonical;
        }
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('!clawdotpump')) continue;

        // Match key: value or key = value
        const match = trimmed.match(/^([a-zA-Z_]+)\s*[:=]\s*(.+)$/);
        if (match) {
            const rawKey = match[1].toLowerCase();
            const value = match[2].trim().replace(/^["']|["']$/g, ''); // strip quotes
            const canonical = aliasMap[rawKey];
            if (canonical) {
                data[canonical] = value;
            }
        }
    }

    return Object.keys(data).length > 0 ? data : null;
}

/**
 * Validate parsed fields and return normalized data.
 */
function validateFields(data) {
    const errors = [];

    const name = (data.name || '').trim().slice(0, 50);
    const symbol = (data.symbol || data.ticker || '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
    const wallet = (data.wallet || data.address || data.recipient || '').trim();
    const description = (data.description || data.desc || data.about || data.bio || '').trim().slice(0, 500);
    const image = (data.image || data.img || data.logo || data.icon || '').trim();
    const website = (data.website || data.site || data.url || data.link || data.homepage || '').trim() || null;
    const twitter = (data.twitter || data.x || data.social || '').trim() || null;

    if (!name) errors.push('name is required');
    if (!symbol) errors.push('symbol is required');
    if (!description || description.length < 20) errors.push('description must be at least 20 characters');
    if (!image) errors.push('image URL is required');

    // Validate Solana address (base58, 32-44 chars)
    if (wallet && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
        errors.push('wallet must be a valid Solana address (32-44 base58 characters)');
    }

    // Validate image URL
    if (image && !isValidImageUrl(image)) {
        errors.push('image must be a direct URL to an image file');
    }

    if (errors.length > 0) {
        return { success: false, error: errors.join('; ') };
    }

    return {
        success: true,
        data: { name, symbol, wallet, description, image, website, twitter },
    };
}

/**
 * Check if a URL looks like a direct image link.
 */
function isValidImageUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        // Allow known image hosts or files ending in image extensions
        const knownHosts = ['iili.io', 'i.imgur.com', 'arweave.net', 'freeimage.host'];
        const extMatch = parsed.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
        return !!extMatch || knownHosts.some(h => parsed.hostname.includes(h));
    } catch {
        return false;
    }
}
