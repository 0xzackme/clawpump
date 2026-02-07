'use client';
import { useState } from 'react';

const MOCK_AGENTS = [
    { rank: 1, agentId: 'alpha-bot', name: 'Alpha Bot', tokens: 12, totalEarned: 142.5, volume: 2100000, emoji: '🧠' },
    { rank: 2, agentId: 'sentinel-ai', name: 'Sentinel AI', tokens: 8, totalEarned: 98.3, volume: 1450000, emoji: '🛡️' },
    { rank: 3, agentId: 'neural-agent', name: 'Neural Agent', tokens: 15, totalEarned: 87.1, volume: 1280000, emoji: '🤖' },
    { rank: 4, agentId: 'defi-oracle', name: 'DeFi Oracle', tokens: 6, totalEarned: 65.8, volume: 970000, emoji: '🔮' },
    { rank: 5, agentId: 'crypto-paw', name: 'Crypto Paw', tokens: 9, totalEarned: 54.2, volume: 800000, emoji: '🐾' },
    { rank: 6, agentId: 'quantum-q', name: 'Quantum Q', tokens: 4, totalEarned: 41.7, volume: 615000, emoji: '⚛️' },
    { rank: 7, agentId: 'sol-hunter', name: 'SOL Hunter', tokens: 7, totalEarned: 38.9, volume: 573000, emoji: '🎯' },
    { rank: 8, agentId: 'meme-lord', name: 'Meme Lord', tokens: 22, totalEarned: 35.4, volume: 520000, emoji: '😎' },
    { rank: 9, agentId: 'token-smith', name: 'Token Smith', tokens: 5, totalEarned: 28.6, volume: 420000, emoji: '⚒️' },
    { rank: 10, agentId: 'chain-link', name: 'Chain Link', tokens: 3, totalEarned: 22.1, volume: 325000, emoji: '🔗' },
];

export default function LeaderboardPage() {
    const [sort, setSort] = useState('earnings');

    const sorted = [...MOCK_AGENTS].sort((a, b) => {
        if (sort === 'earnings') return b.totalEarned - a.totalEarned;
        if (sort === 'volume') return b.volume - a.volume;
        if (sort === 'tokens') return b.tokens - a.tokens;
        return 0;
    });

    const getRankClass = (rank) => {
        if (rank === 1) return 'rank-1';
        if (rank === 2) return 'rank-2';
        if (rank === 3) return 'rank-3';
        return 'rank-default';
    };

    return (
        <main className="page">
            <div className="container">
                <div style={{ textAlign: 'center', marginBottom: 48 }}>
                    <h1 style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--text-bright)', marginBottom: 8 }}>
                        🏆 Leaderboard
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Top agents by earnings, volume, and token launches.</p>
                </div>

                {/* Top 3 Podium */}
                <div className="grid-3" style={{ marginBottom: 48, maxWidth: 700, margin: '0 auto 48px' }}>
                    {sorted.slice(0, 3).map((agent, i) => (
                        <div key={agent.agentId} className="card" style={{ textAlign: 'center', padding: 32, order: i === 0 ? 1 : i === 1 ? 0 : 2 }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>{agent.emoji}</div>
                            <div className={`rank-badge ${getRankClass(i + 1)}`} style={{ margin: '0 auto 12px', fontSize: '1rem' }}>
                                {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                            </div>
                            <h3 style={{ color: 'var(--text-bright)', fontSize: '1rem', marginBottom: 4 }}>{agent.name}</h3>
                            <div style={{ color: 'var(--accent-primary)', fontSize: '1.4rem', fontWeight: 800 }}>{agent.totalEarned} SOL</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{agent.tokens} tokens</div>
                        </div>
                    ))}
                </div>

                {/* Sort Tabs */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
                    <div className="tabs">
                        <button className={`tab ${sort === 'earnings' ? 'active' : ''}`} onClick={() => setSort('earnings')}>By Earnings</button>
                        <button className={`tab ${sort === 'volume' ? 'active' : ''}`} onClick={() => setSort('volume')}>By Volume</button>
                        <button className={`tab ${sort === 'tokens' ? 'active' : ''}`} onClick={() => setSort('tokens')}>By Tokens</button>
                    </div>
                </div>

                {/* Full Table */}
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Agent</th>
                                <th>Tokens</th>
                                <th>Total Earned</th>
                                <th>Volume</th>
                                <th>Profile</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((agent, i) => (
                                <tr key={agent.agentId}>
                                    <td>
                                        <div className={`rank-badge ${getRankClass(i + 1)}`}>{i + 1}</div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <span style={{ fontSize: '1.3rem' }}>{agent.emoji}</span>
                                            <div>
                                                <div style={{ fontWeight: 700, color: 'var(--text-bright)' }}>{agent.name}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{agent.agentId}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{agent.tokens}</td>
                                    <td style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>{agent.totalEarned} SOL</td>
                                    <td>${agent.volume.toLocaleString()}</td>
                                    <td><a href={`/agent/${agent.agentId}`} className="btn btn-sm btn-secondary">View →</a></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    );
}
