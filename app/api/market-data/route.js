import { NextResponse } from 'next/server';
import { getTokensPaginatedAsync } from '@/lib/db';

/**
 * GET /api/market-data — Fetch real-time market data from DexScreener
 *
 * Merges DexScreener price/mcap/volume with database token data.
 * Caches results for 60 seconds to avoid rate limiting.
 * New tokens without DEX data get default $2,400 mcap (pump.fun initial curve).
 */

const PUMP_FUN_INITIAL_MCAP = 2400;
const CACHE_TTL_MS = 60_000;

let cache = { data: null, timestamp: 0 };

async function fetchDexScreenerData(mintAddresses) {
    if (!mintAddresses.length) return {};

    const results = {};
    const chunks = [];
    for (let i = 0; i < mintAddresses.length; i += 30) {
        chunks.push(mintAddresses.slice(i, i + 30));
    }

    for (const chunk of chunks) {
        try {
            const url = `https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`;
            const res = await fetch(url, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(8000),
            });

            if (!res.ok) continue;

            const pairs = await res.json();
            if (Array.isArray(pairs)) {
                for (const pair of pairs) {
                    const mint = pair.baseToken?.address;
                    if (!mint) continue;
                    if (!results[mint] || (pair.liquidity?.usd || 0) > (results[mint].liquidity?.usd || 0)) {
                        results[mint] = {
                            priceUsd: parseFloat(pair.priceUsd) || 0,
                            marketCap: pair.marketCap || pair.fdv || 0,
                            volume24h: pair.volume?.h24 || 0,
                            priceChange24h: pair.priceChange?.h24 || 0,
                            liquidity: pair.liquidity?.usd || 0,
                            dexId: pair.dexId || 'unknown',
                            pairAddress: pair.pairAddress,
                            url: pair.url,
                        };
                    }
                }
            }
        } catch (err) {
            console.error('[market-data] DexScreener fetch error:', err.message);
        }
    }

    return results;
}

export async function GET() {
    try {
        const now = Date.now();

        if (cache.data && (now - cache.timestamp) < CACHE_TTL_MS) {
            return NextResponse.json(cache.data);
        }

        const { tokens } = await getTokensPaginatedAsync({ limit: 200, sort: 'new' });

        const mintAddresses = tokens
            .map(t => t.mintAddress)
            .filter(Boolean);

        const dexData = await fetchDexScreenerData(mintAddresses);

        const enriched = tokens.map(token => {
            const market = token.mintAddress ? dexData[token.mintAddress] : null;

            return {
                name: token.name,
                symbol: token.symbol,
                description: token.description,
                imageUrl: token.imageUrl,
                agentId: token.agentId,
                agentName: token.agentName,
                mintAddress: token.mintAddress,
                pumpUrl: token.pumpUrl,
                explorerUrl: token.explorerUrl,
                createdAt: token.createdAt,
                source: token.source,
                feeSplit: {
                    creator: token.creatorSharePct || 70,
                    platform: token.platformSharePct || 30,
                },
                priceUsd: market?.priceUsd || 0,
                marketCap: market?.marketCap || PUMP_FUN_INITIAL_MCAP,
                volume24h: market?.volume24h || 0,
                totalVolume: token.totalVolume || 0,
                priceChange24h: market?.priceChange24h || 0,
                liquidity: market?.liquidity || 0,
                dexUrl: market?.url || token.pumpUrl,
                hasMarketData: !!market,
            };
        });

        const result = {
            success: true,
            tokens: enriched,
            total: enriched.length,
            lastUpdated: new Date().toISOString(),
            source: 'dexscreener',
            cacheTtlMs: CACHE_TTL_MS,
        };

        cache = { data: result, timestamp: now };

        return NextResponse.json(result);
    } catch (error) {
        console.error('[market-data] Error:', error);
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
