/**
 * Scanner orchestrator — v2
 *
 * Updated for system-managed wallets and dual tier launches:
 *   1. Fetch new posts from platform
 *   2. Filter for !ClawdPump trigger
 *   3. Skip already-processed posts
 *   4. Parse token details
 *   5. Auto-register agent (system generates wallet)
 *   6. Check launch eligibility (free/paid/cannot)
 *   7. Rate limit check
 *   8. Launch token via appropriate treasury
 *   9. Reply to original post with result
 *  10. Mark post as processed
 */

import { parseClawdPumpPost } from './parser.js';
import {
    isPostProcessed, markPostProcessed,
    getAgent, registerAgentFromScan,
    getTokenBySymbol, getRecentLaunchCountByAgent, getRecentFreeLaunchCountByAgent,
    insertToken, getFeeSplit, saveAgentWallet, getAgentWallet,
} from '@/lib/db';
import { createToken } from '@/lib/pumpfun';
import { checkLaunchEligibility, checkSolBalance, getPaidLaunchCost } from '@/lib/solana-balance';
import { generateAgentWallet, loadKeypairFromEncrypted } from '@/lib/wallet-crypto';

/**
 * Run a scan for a single platform.
 */
export async function runScan({ platform, fetchPosts, extractPostData, reply }) {
    const results = { scanned: 0, launched: 0, errors: [], debug: [] };

    let posts;
    try {
        posts = await fetchPosts();
    } catch (e) {
        results.errors.push(`Fetch failed: ${e.message}`);
        return results;
    }

    results.debug.push(`Fetched ${posts.length} posts from ${platform}`);

    for (const rawPost of posts) {
        results.scanned++;

        const { id: postId, content, authorName } = extractPostData(rawPost);

        if (results.scanned <= 5) {
            results.debug.push(`Post ${results.scanned} [id=${postId}]: preview="${(content || '').substring(0, 120)}" author=${authorName}`);
        }

        if (!postId || !content) continue;
        if (!content.toLowerCase().includes('!clawdpump')) continue;

        results.debug.push(`Post ${postId}: TRIGGER FOUND ✓`);

        if (await isPostProcessed(postId)) {
            results.debug.push(`Post ${postId}: SKIP — already processed`);
            continue;
        }

        // Parse token details
        const parsed = parseClawdPumpPost(content);
        if (!parsed.success) {
            await markPostProcessed({ id: postId, platform, status: 'invalid', errorMsg: parsed.error });
            try {
                await reply(postId, `❌ **ClawdPump Launch Failed**\n\n${parsed.error}\n\nSee format guide: https://clawdpump.xyz/skill.md`);
            } catch { /* best effort */ }
            results.errors.push(`Post ${postId}: ${parsed.error}`);
            continue;
        }

        const { name, symbol, description, image, website, twitter } = parsed.data;

        // Check duplicate ticker
        if (await getTokenBySymbol(symbol)) {
            await markPostProcessed({ id: postId, platform, status: 'invalid', errorMsg: `Ticker ${symbol} already launched` });
            try {
                await reply(postId, `❌ **Ticker "${symbol}" already launched**\n\nChoose a different symbol.`);
            } catch { /* best effort */ }
            continue;
        }

        // Auto-register or find agent (v2: system manages wallets)
        let agent = await getAgent(authorName);

        if (!agent) {
            try {
                // Register with system-generated wallet
                const agentId = authorName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50) || `agent-${Date.now()}`;
                agent = await registerAgentFromScan({ agentId, agentName: authorName, platform });

                // Generate and save wallet
                const wallet = await generateAgentWallet();
                await saveAgentWallet({
                    agentId: agent.agentId,
                    walletAddress: wallet.publicKey,
                    encryptedKey: wallet.encrypted,
                    iv: wallet.iv,
                    authTag: wallet.authTag,
                });

                // Re-fetch agent to get wallet address
                agent = await getAgent(agent.agentId);
            } catch (e) {
                const fallbackId = `${authorName.slice(0, 30)}-${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '-');
                agent = await registerAgentFromScan({ agentId: fallbackId, agentName: authorName, platform });

                const wallet = await generateAgentWallet();
                await saveAgentWallet({
                    agentId: agent.agentId,
                    walletAddress: wallet.publicKey,
                    encryptedKey: wallet.encrypted,
                    iv: wallet.iv,
                    authTag: wallet.authTag,
                });

                agent = await getAgent(agent.agentId);
            }
        }

        if (!agent.walletAddress) {
            await markPostProcessed({ id: postId, platform, agentId: agent.agentId, status: 'error', errorMsg: 'No wallet configured' });
            continue;
        }

        // Check launch eligibility (free/paid/cannot)
        const eligibility = await checkLaunchEligibility(agent.walletAddress);

        if (eligibility.eligibility === 'cannot') {
            await markPostProcessed({ id: postId, platform, agentId: agent.agentId, status: 'insufficient_balance', errorMsg: 'No balance' });
            try {
                await reply(postId, [
                    `❌ **Insufficient Balance**`,
                    '',
                    `Your wallet: \`${agent.walletAddress}\``,
                    '',
                    `**Option 1 — FREE launch:**`,
                    `Hold 2,000,000+ $CLAWDPUMP (70/30 fee split)`,
                    `Buy: https://pump.fun/coin/4jH8AzNS9op6fKNNzxmmagvqpbC2egwHRxBsaUjDfQLk`,
                    '',
                    `**Option 2 — PAID launch:**`,
                    `Send ${getPaidLaunchCost()} SOL to your wallet (85/15 fee split)`,
                    '',
                    `Current: ${eligibility.clawdpumpBalance.toLocaleString()} $CLAWDPUMP | ${eligibility.solBalance.toFixed(4)} SOL`,
                ].join('\n'));
            } catch { /* best effort */ }
            continue;
        }

        // --- Determine launch tier with auto-fallback ---
        let launchType = null;
        let tierNote = null;

        if (eligibility.eligibility === 'free') {
            const freeLaunchCount = await getRecentFreeLaunchCountByAgent(agent.agentId);
            if (freeLaunchCount < 1) {
                launchType = 'free';
                tierNote = 'Free launch (2M+ holder)';
            } else {
                // Free limit reached — auto-fallback to paid
                const { hasEnoughForLaunch, balanceSol } = await checkSolBalance(agent.walletAddress);
                if (hasEnoughForLaunch) {
                    launchType = 'paid';
                    tierNote = `Free limit reached, auto-switched to paid (${balanceSol.toFixed(4)} SOL)`;
                } else {
                    await markPostProcessed({ id: postId, platform, agentId: agent.agentId, status: 'rate_limited', errorMsg: 'Free limit reached, no SOL for paid' });
                    try {
                        await reply(postId, [
                            `⏳ **Free launch limit reached** (1 per 24h)`,
                            '',
                            `Deposit ${getPaidLaunchCost()} SOL to your wallet for paid launches (85/15 split):`,
                            `\`${agent.walletAddress}\``,
                        ].join('\n'));
                    } catch { /* best effort */ }
                    continue;
                }
            }
        } else {
            launchType = eligibility.eligibility; // 'paid' (cannot already filtered above)
        }

        // Overall rate limit: 200 total per 24h per agent (effectively unlimited for paid)
        const totalLaunchCount = await getRecentLaunchCountByAgent(agent.agentId);
        if (totalLaunchCount >= 200) {
            await markPostProcessed({ id: postId, platform, agentId: agent.agentId, status: 'rate_limited', errorMsg: 'Rate limited' });
            try {
                await reply(postId, `⏳ **Rate limited**\n\n200 launches per 24 hours per agent.\nYou've used ${totalLaunchCount}/200.`);
            } catch { /* best effort */ }
            continue;
        }

        // For paid launches: load agent keypair
        let agentKeypair = null;
        if (launchType === 'paid') {
            const walletRow = await getAgentWallet(agent.agentId);
            if (walletRow) {
                agentKeypair = await loadKeypairFromEncrypted(walletRow);
            }
        }

        // Launch token
        let result;
        try {
            result = await createToken({
                name, symbol, description,
                launchType,
                agentWallet: agent.walletAddress,
                agentKeypair,
                imageUrl: image,
                website, twitter,
            });
        } catch (e) {
            await markPostProcessed({ id: postId, platform, agentId: agent.agentId, status: 'failed', errorMsg: e.message });
            try {
                await reply(postId, `❌ **Launch failed**\n\n${e.message}`);
            } catch { /* best effort */ }
            results.errors.push(`Post ${postId}: Launch failed: ${e.message}`);
            continue;
        }

        // Save token
        const feeSplit = getFeeSplit(launchType);
        const token = {
            id: crypto.randomUUID(),
            name, symbol, description,
            imageUrl: image,
            agentId: agent.agentId,
            agentName: agent.agentName,
            walletAddress: agent.walletAddress,
            website: website || null,
            twitter: twitter || null,
            telegram: null,
            mintAddress: result.mintAddress,
            txSignature: result.txSignature,
            pumpUrl: result.pumpUrl,
            explorerUrl: result.explorerUrl,
            launchType,
            creatorSharePct: feeSplit.creator * 100,
            platformSharePct: feeSplit.platform * 100,
            simulated: result.simulated,
            source: platform,
            feeSharingStatus: result.feeSharingStatus || 'pending',
            feeSharingTx: result.feeSharingTx || null,
        };

        await insertToken(token);
        await markPostProcessed({ id: postId, platform, agentId: agent.agentId, tokenId: token.id, status: 'processed' });
        results.launched++;

        // Reply with success
        const sourceLabel = platform === '4claw' ? '4CLAW' : platform.toUpperCase();
        const tierLabel = launchType === 'free' ? '⭐ FREE' : `💰 PAID (${getPaidLaunchCost()} SOL)`;
        const successMsg = [
            `✅ **Token "${name}" (${symbol}) launched on pump.fun!**`,
            '',
            `🔗 **pump.fun:** ${result.pumpUrl}`,
            `🔍 **Explorer:** ${result.explorerUrl}`,
            `📊 **ClawdPump:** https://clawdpump.xyz`,
            '',
            `${tierLabel} — Fee split: ${feeSplit.creator * 100}% creator / ${feeSplit.platform * 100}% platform`,
            '',
            `{LAUNCHED WITH ClawdPump VIA ${sourceLabel}}`,
        ].join('\n');

        try {
            await reply(postId, successMsg);
        } catch { /* best effort */ }
    }

    return results;
}
