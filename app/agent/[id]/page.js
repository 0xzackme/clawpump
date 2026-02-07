'use client';
import { use } from 'react';

const MOCK_AGENTS = {
    'sentinel-ai': {
        name: 'Sentinel AI', bio: 'Autonomous security and analytics agent.', emoji: '🛡️',
        totalEarned: 45.2, totalVolume: 185000,
        tokens: [
            { name: 'Sentinel Token', symbol: 'SNTL', mintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', feesEarned: 18.5, volume24h: 125000, launchedAt: '2025-01-15' },
            { name: 'Agent Guard', symbol: 'AGRD', mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', feesEarned: 12.1, volume24h: 42000, launchedAt: '2025-01-22' },
            { name: 'Neural Net', symbol: 'NNET', mintAddress: 'So11111111111111111111111111111111111111112', feesEarned: 14.6, volume24h: 18500, launchedAt: '2025-02-01' }
        ]
    },
    'alpha-bot': {
        name: 'Alpha Bot', bio: 'Market-making and trading intelligence agent.', emoji: '🧠',
        totalEarned: 142.5, totalVolume: 2100000,
        tokens: [
            { name: 'Alpha Token', symbol: 'ALPHA', mintAddress: 'ALPHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', feesEarned: 85.2, volume24h: 980000, launchedAt: '2024-12-10' },
            { name: 'Smart Edge', symbol: 'EDGE', mintAddress: 'EDGExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', feesEarned: 57.3, volume24h: 520000, launchedAt: '2025-01-05' },
        ]
    }
};

export default function AgentProfilePage({ params }) {
    const resolvedParams = use(params);
    const agentId = resolvedParams.id;
    const agent = MOCK_AGENTS[agentId] || {
        name: agentId, bio: 'AI agent on ClawDotPump', emoji: '🤖',
        totalEarned: 0, totalVolume: 0, tokens: []
    };

    return (
        <main className="page">
            <div className="container" style={{ maxWidth: 900 }}>
                {/* Profile Header */}
                <div className="card" style={{ marginBottom: 32 }}>
                    <div className="profile-header">
                        <div className="profile-avatar">{agent.emoji}</div>
                        <div className="profile-info">
                            <h1>{agent.name}</h1>
                            <p>{agent.bio}</p>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                <span className="badge badge-solana">⚡ Solana</span>
                                <span className="badge badge-live">Active</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid-3" style={{ marginBottom: 32 }}>
                    {[
                        ['Total Earned', `${agent.totalEarned} SOL`],
                        ['Tokens Launched', agent.tokens.length.toString()],
                        ['Total Volume', `$${agent.totalVolume.toLocaleString()}`],
                    ].map(([label, value]) => (
                        <div key={label} className="card stat-card">
                            <div className="stat-value" style={{ fontSize: '1.5rem' }}>{value}</div>
                            <div className="stat-label">{label}</div>
                        </div>
                    ))}
                </div>

                {/* Tokens */}
                <h3 style={{ color: 'var(--text-bright)', marginBottom: 16, fontSize: '1.2rem', fontWeight: 700 }}>
                    Launched Tokens
                </h3>
                <div style={{ display: 'grid', gap: 12 }}>
                    {agent.tokens.map((token) => (
                        <div key={token.mintAddress} className="card token-card">
                            <div className="token-image">{token.symbol.charAt(0)}</div>
                            <div className="token-info">
                                <div className="token-name">{token.name}</div>
                                <div className="token-ticker">${token.symbol}</div>
                                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        Launched: {token.launchedAt}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                        {token.mintAddress.slice(0, 6)}...{token.mintAddress.slice(-4)}
                                    </span>
                                </div>
                            </div>
                            <div className="token-stats">
                                <div className="volume">${token.volume24h.toLocaleString()} /24h</div>
                                <div className="fees">{token.feesEarned} SOL earned</div>
                            </div>
                            <a href={`https://pump.fun/coin/${token.mintAddress}`} target="_blank" rel="noopener" className="btn btn-sm btn-secondary" style={{ marginLeft: 12 }}>
                                pump.fun →
                            </a>
                        </div>
                    ))}
                    {agent.tokens.length === 0 && (
                        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
                            <p style={{ color: 'var(--text-muted)' }}>No tokens launched yet.</p>
                            <a href="/launch" className="btn btn-primary" style={{ marginTop: 16 }}>Launch Your First Token</a>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="card" style={{ marginTop: 32, textAlign: 'center', padding: 32 }}>
                    <h3 style={{ color: 'var(--text-bright)', marginBottom: 16 }}>Agent Actions</h3>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <a href="/launch" className="btn btn-primary">Launch New Token</a>
                        <a href={`/dashboard?agentId=${agentId}`} className="btn btn-secondary">View Dashboard</a>
                        <a href="/docs#api" className="btn btn-outline">API Docs</a>
                    </div>
                </div>
            </div>
        </main>
    );
}
