'use client';
import { useState } from 'react';

const MOCK_AGENTS = [
    {
        agentId: 'sentinel-ai',
        agentName: 'Sentinel AI',
        totalEarned: 45.2,
        totalPending: 3.8,
        tokens: [
            { name: 'Sentinel Token', symbol: 'SNTL', mintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', volume24h: 125000, feesEarned: 18.5, pumpUrl: 'https://pump.fun/coin/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
            { name: 'Agent Guard', symbol: 'AGRD', mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', volume24h: 42000, feesEarned: 12.1, pumpUrl: 'https://pump.fun/coin/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
            { name: 'Neural Net', symbol: 'NNET', mintAddress: 'So11111111111111111111111111111111111111112', volume24h: 18500, feesEarned: 14.6, pumpUrl: 'https://pump.fun/coin/So11111111111111111111111111111111111111112' }
        ]
    }
];

export default function DashboardPage() {
    const [agentId, setAgentId] = useState('');
    const [agent, setAgent] = useState(MOCK_AGENTS[0]);
    const [searched, setSearched] = useState(true);

    const handleSearch = () => {
        const found = MOCK_AGENTS.find(a => a.agentId === agentId);
        setAgent(found || MOCK_AGENTS[0]);
        setSearched(true);
    };

    return (
        <main className="page">
            <div className="container">
                <div style={{ marginBottom: 48 }}>
                    <h1 style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--text-bright)', marginBottom: 8 }}>
                        Agent Dashboard
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Track your tokens, earnings, and fee distributions.</p>
                </div>

                {/* Search */}
                <div className="search-bar">
                    <input
                        className="form-input"
                        placeholder="Enter Agent ID (e.g. sentinel-ai)"
                        value={agentId}
                        onChange={(e) => setAgentId(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    />
                    <button className="btn btn-primary" onClick={handleSearch}>Search</button>
                </div>

                {searched && agent && (
                    <>
                        {/* Stats */}
                        <div className="grid-4" style={{ marginBottom: 40 }}>
                            {[
                                ['Total Earned', `${agent.totalEarned} SOL`, `~$${(agent.totalEarned * 200).toLocaleString()}`],
                                ['Pending', `${agent.totalPending} SOL`, 'Next distribution: ~1hr'],
                                ['Tokens Launched', agent.tokens.length.toString(), 'Active on pump.fun'],
                                ['24h Volume', `$${agent.tokens.reduce((s, t) => s + t.volume24h, 0).toLocaleString()}`, 'Across all tokens']
                            ].map(([label, value, sub]) => (
                                <div key={label} className="card stat-card">
                                    <div className="stat-value" style={{ fontSize: '1.6rem' }}>{value}</div>
                                    <div className="stat-label">{label}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>
                                </div>
                            ))}
                        </div>

                        {/* Agent Profile */}
                        <div className="card" style={{ marginBottom: 24 }}>
                            <div className="profile-header">
                                <div className="profile-avatar">🤖</div>
                                <div className="profile-info">
                                    <h1>{agent.agentName}</h1>
                                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>ID: {agent.agentId}</p>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                        <span className="badge badge-solana">Solana</span>
                                        <span className="badge badge-live">Active</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Tokens */}
                        <h3 style={{ color: 'var(--text-bright)', marginBottom: 16, fontSize: '1.2rem', fontWeight: 700 }}>
                            Launched Tokens ({agent.tokens.length})
                        </h3>
                        <div style={{ display: 'grid', gap: 12 }}>
                            {agent.tokens.map((token) => (
                                <div key={token.mintAddress} className="card token-card">
                                    <div className="token-image">{token.symbol.charAt(0)}</div>
                                    <div className="token-info">
                                        <div className="token-name">{token.name}</div>
                                        <div className="token-ticker">${token.symbol}</div>
                                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                            {token.mintAddress.slice(0, 8)}...{token.mintAddress.slice(-6)}
                                        </div>
                                    </div>
                                    <div className="token-stats">
                                        <div className="volume">${token.volume24h.toLocaleString()} vol</div>
                                        <div className="fees">{token.feesEarned} SOL earned</div>
                                    </div>
                                    <a href={token.pumpUrl} target="_blank" rel="noopener" className="btn btn-sm btn-secondary" style={{ marginLeft: 12 }}>
                                        pump.fun →
                                    </a>
                                </div>
                            ))}
                        </div>

                        {/* Fee Distribution */}
                        <div className="card" style={{ marginTop: 24 }}>
                            <h3 style={{ color: 'var(--text-bright)', marginBottom: 16 }}>Fee Distribution History</h3>
                            <div className="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Token</th>
                                            <th>Amount (SOL)</th>
                                            <th>Status</th>
                                            <th>Tx</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            ['2025-02-07', 'SNTL', '2.45', 'Sent', '5VER...sVFi'],
                                            ['2025-02-06', 'AGRD', '1.80', 'Sent', '3KmN...aPxR'],
                                            ['2025-02-06', 'SNTL', '3.12', 'Sent', '7bQx...nF2T'],
                                            ['2025-02-05', 'NNET', '0.95', 'Sent', '9dRw...kL4Y'],
                                            ['2025-02-05', 'SNTL', '4.20', 'Pending', '—'],
                                        ].map(([date, token, amount, status, tx], i) => (
                                            <tr key={i}>
                                                <td>{date}</td>
                                                <td><strong>${token}</strong></td>
                                                <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{amount}</td>
                                                <td><span className={`badge ${status === 'Sent' ? 'badge-live' : 'badge-solana'}`}>{status}</span></td>
                                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{tx}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Claim Fees */}
                        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: 32 }}>
                            <h3 style={{ color: 'var(--text-bright)', marginBottom: 8 }}>Claim Creator Fees</h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 20 }}>
                                Use PumpPortal API to claim your pending creator fees from pump.fun.
                            </p>
                            <div className="code-block" style={{ textAlign: 'left', fontSize: '0.8rem', marginBottom: 16 }}>
                                <code>
                                    <span className="code-keyword">POST</span> <span className="code-url">https://pumpportal.fun/api/trade</span>{'\n'}
                                    {'{'}{'\n'}
                                    {"  "}<span className="code-string">"action"</span>: "claim",{'\n'}
                                    {"  "}<span className="code-string">"mint"</span>: "{agent.tokens[0]?.mintAddress}",{'\n'}
                                    {"  "}<span className="code-string">"denominatedInSol"</span>: "true"{'\n'}
                                    {'}'}
                                </code>
                            </div>
                            <a href="https://pumpportal.fun/creator-fee" target="_blank" rel="noopener" className="btn btn-outline">
                                View PumpPortal Docs →
                            </a>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}
