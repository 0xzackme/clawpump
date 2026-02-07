/**
 * Scanner orchestrator.
 *
 * Shared logic for all platform scanners:
 *   1. Fetch new posts from platform
 *   2. Filter for !clawdotpump trigger
 *   3. Skip already-processed posts
 *   4. Parse token details
 *   5. Auto-register agent if needed
 *   6. Check rate limits & duplicate tickers
 *   7. Launch token via pump.fun
 *   8. Reply to original post with result
 *   9. Mark post as processed
 */

import { parseClawdotpumpPost } from './parser.js';
import {
    isPostProcessed, markPostProcessed,
    getAgent, getAgentByWallet, registerAgentFromScan,
    getTokenBySymbol, getRecentLaunchCountByAgent,
    insertToken, getFeeSplit,
} from '@/lib/db';
import { createToken } from '@/lib/pumpfun';
import { isValidSolanaAddress } from '@/lib/sanitize';

/**
 * Run a scan for a single platform.
 *
 * @param {object} opts
 * @param {string} opts.platform - 'moltbook' | '4claw'
 * @param {Function} opts.fetchPosts - Async function returning array of raw posts
 * @param {Function} opts.extractPostData - Extracts { id, content, authorName } from raw post
 * @param {Function} opts.reply - Async function(postId, message) to reply with results
 * @returns {Promise<{ scanned: number, launched: number, errors: string[] }>}
 */
export async function runScan({ platform, fetchPosts, extractPostData, reply }) {
    const results = { scanned: 0, launched: 0, errors: [] };

    let posts;
    try {
        posts = await fetchPosts();
    } catch (e) {
        results.errors.push(`Fetch failed: ${e.message}`);
        return results;
    }

    for (const rawPost of posts) {
        results.scanned++;

        const { id: postId, content, authorName } = extractPostData(rawPost);
        if (!postId || !content) continue;

        // Skip if no trigger
        if (!content.toLowerCase().includes('!clawdotpump')) continue;

        // Skip already-processed
        if (isPostProcessed(postId)) continue;

        // Parse token details
        const parsed = parseClawdotpumpPost(content);
        if (!parsed.success) {
            markPostProcessed({ id: postId, platform, status: 'invalid', errorMsg: parsed.error });
            try {
                await reply(postId, `❌ **ClawDotPump Launch Failed**\n\n${parsed.error}\n\nSee format guide: https://clawdotpump.com/skill.md`);
            } catch { /* best effort */ }
            results.errors.push(`Post ${postId}: ${parsed.error}`);
            continue;
        }

        const { name, symbol, wallet, description, image, website, twitter } = parsed.data;

        // Check duplicate ticker
        if (getTokenBySymbol(symbol)) {
            markPostProcessed({ id: postId, platform, status: 'invalid', errorMsg: `Ticker ${symbol} already launched` });
            try {
                await reply(postId, `❌ **Ticker "${symbol}" already launched**\n\nChoose a different symbol.`);
            } catch { /* best effort */ }
            continue;
        }

        // Auto-register or find agent
        let agent = (wallet ? getAgentByWallet(wallet) : null) || getAgent(authorName);

        // Determine the wallet to use: agent's stored wallet takes priority
        let launchWallet = agent ? agent.walletAddress : wallet;

        if (!agent) {
            // First-time poster — need a wallet to register
            if (!wallet || !isValidSolanaAddress(wallet)) {
                markPostProcessed({ id: postId, platform, status: 'invalid', errorMsg: 'Unregistered agent must provide a valid Solana wallet' });
                try {
                    await reply(postId, `❌ **Wallet required for first launch**\n\nInclude \`wallet: YourSolanaAddress\` in your post, or register at the API first.`);
                } catch { /* best effort */ }
                continue;
            }

            try {
                agent = registerAgentFromScan({
                    agentId: authorName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50) || `agent-${Date.now()}`,
                    agentName: authorName,
                    walletAddress: wallet,
                    platform,
                });
            } catch (e) {
                const fallbackId = `${authorName.slice(0, 30)}-${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '-');
                agent = registerAgentFromScan({
                    agentId: fallbackId,
                    agentName: authorName,
                    walletAddress: wallet,
                    platform,
                });
            }
            launchWallet = wallet;
        }

        // Rate limit: 10 per 6h per agent (shared across all platforms)
        const launchCount = getRecentLaunchCountByAgent(agent.agentId);
        if (launchCount >= 10) {
            markPostProcessed({ id: postId, platform, agentId: agent.agentId, status: 'rate_limited', errorMsg: 'Rate limited' });
            try {
                await reply(postId, `⏳ **Rate limited**\n\n10 launches per 6 hours per agent.\nYou've used ${launchCount}/10 in the current window.`);
            } catch { /* best effort */ }
            continue;
        }

        // Launch token via pump.fun
        let result;
        try {
            result = await createToken({
                name,
                symbol,
                description,
                imageUrl: image,
                website,
                twitter,
                agentWallet: launchWallet,
            });
        } catch (e) {
            markPostProcessed({ id: postId, platform, agentId: agent.agentId, status: 'failed', errorMsg: e.message });
            try {
                await reply(postId, `❌ **Launch failed**\n\n${e.message}`);
            } catch { /* best effort */ }
            results.errors.push(`Post ${postId}: Launch failed: ${e.message}`);
            continue;
        }

        // Save token to database
        const feeSplit = getFeeSplit();
        const token = {
            id: crypto.randomUUID(),
            name,
            symbol,
            description,
            imageUrl: image,
            agentId: agent.agentId,
            agentName: agent.agentName,
            walletAddress: launchWallet,
            website: website || null,
            twitter: twitter || null,
            telegram: null,
            mintAddress: result.mintAddress,
            txSignature: result.txSignature,
            pumpUrl: result.pumpUrl,
            explorerUrl: result.explorerUrl,
            burnTxSig: null,
            devAllocation: 0,
            creatorSharePct: feeSplit.creator * 100,
            platformSharePct: feeSplit.platform * 100,
            simulated: result.simulated,
            source: platform,
            createdAt: new Date().toISOString(),
        };

        insertToken(token);
        markPostProcessed({ id: postId, platform, agentId: agent.agentId, tokenId: token.id, status: 'processed' });
        results.launched++;

        // Reply with success
        const sourceLabel = platform === '4claw' ? '4CLAW' : platform.toUpperCase();
        const successMsg = [
            `✅ **Token "${name}" (${symbol}) launched on pump.fun!**`,
            '',
            `🔗 **pump.fun:** ${result.pumpUrl}`,
            `🔍 **Explorer:** ${result.explorerUrl}`,
            `📊 **ClawDotPump:** https://clawdotpump.com`,
            '',
            `💰 Fee split: ${feeSplit.creator * 100}% creator / ${feeSplit.platform * 100}% platform`,
            `⛽ Gas paid by platform — free for agents`,
            '',
            `{LAUNCHED WITH CLAWDOTPUMP VIA ${sourceLabel}}`,
        ].join('\n');

        try {
            await reply(postId, successMsg);
        } catch { /* best effort */ }
    }

    return results;
}
