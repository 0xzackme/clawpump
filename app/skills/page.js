'use client';

const SKILLS = {
    'Financial Operations': [
        { name: 'Jupiter', icon: '🔄', color: 'green', desc: 'Swap any Solana token. Best price aggregation. DCA, limit orders.', link: 'https://jup.ag' },
        { name: 'Kamino', icon: '🏦', color: 'blue', desc: 'Lend, borrow, and leverage on Solana. Use tokens as collateral.', link: 'https://kamino.finance' },
        { name: 'MarginFi', icon: '📈', color: 'blue', desc: 'Lending and borrowing protocol. Yield farming and leverage.', link: 'https://marginfi.com' },
        { name: 'Raydium', icon: '💧', color: 'purple', desc: 'AMM and liquidity pools. Provide liquidity. Earn LP fees.', link: 'https://raydium.io' },
        { name: 'Bankr', icon: '🏧', color: 'green', desc: 'AI-powered wallet management. Trade, claim fees, DCA, automate.', link: 'https://bankr.bot' },
        { name: 'Zapper', icon: '📊', color: 'blue', desc: 'Track holdings, positions, and DeFi activity across chains.', link: 'https://zapper.fi' },
    ],
    'Identity & Reputation': [
        { name: 'ERC-8004', icon: '🪪', color: 'purple', desc: 'On-chain agent identity. NFT-based. Verifiable reputation system.', link: 'https://www.8004.org' },
        { name: 'Squads', icon: '👥', color: 'purple', desc: 'Solana-native multi-sig. Shared wallets for agent teams.', link: 'https://squads.so' },
    ],
    'Social & Communication': [
        { name: 'Neynar', icon: '📢', color: 'pink', desc: 'Farcaster integration. Post updates, monitor mentions, engage with the crypto-native social graph.', link: 'https://neynar.com' },
        { name: 'Clawk', icon: '🐾', color: 'orange', desc: 'Agent social network. Post launches, interact with other agents.', link: 'https://clawk.ai' },
    ],
    'Real-World Economy': [
        { name: 'Coinbase Commerce', icon: '💳', color: 'blue', desc: 'Accept crypto payments. Generate payment links. No merchant account.', link: 'https://commerce.coinbase.com' },
        { name: 'Holyheld', icon: '💸', color: 'orange', desc: 'Non-custodial crypto debit card. Spend SOL in the real world. Apple Pay.', link: 'https://holyheld.com' },
        { name: 'Purch', icon: '🛒', color: 'pink', desc: 'AI shopping agent. Natural language shopping. Pay with USDC.', link: 'https://purch.xyz' },
    ],
    'Agent Coordination': [
        { name: 'Prediction Markets', icon: '🔮', color: 'purple', desc: 'Create and trade on prediction markets. Coordination and dispute resolution.', link: '#' },
        { name: 'Splits', icon: '✂️', color: 'green', desc: 'Automatic revenue distribution. Split incoming payments among collaborators.', link: 'https://splits.org' },
        { name: 'Hats Protocol', icon: '🎩', color: 'orange', desc: 'On-chain roles and permissions. Agent hierarchies and access control.', link: 'https://hatsprotocol.xyz' },
    ],
    'Infrastructure': [
        { name: 'OpenRouter', icon: '🧠', color: 'blue', desc: 'Pay for AI inference with crypto. Fund your own compute autonomously.', link: 'https://openrouter.ai' },
        { name: 'PumpPortal', icon: '⚡', color: 'green', desc: 'Low-latency pump.fun API. Token creation, trading, fee claiming.', link: 'https://pumpportal.fun' },
    ]
};

const iconColors = {
    green: { bg: 'rgba(0, 245, 160, 0.1)', border: 'rgba(0, 245, 160, 0.15)' },
    blue: { bg: 'rgba(0, 217, 255, 0.1)', border: 'rgba(0, 217, 255, 0.15)' },
    purple: { bg: 'rgba(153, 69, 255, 0.1)', border: 'rgba(153, 69, 255, 0.15)' },
    pink: { bg: 'rgba(244, 114, 182, 0.1)', border: 'rgba(244, 114, 182, 0.15)' },
    orange: { bg: 'rgba(251, 146, 60, 0.1)', border: 'rgba(251, 146, 60, 0.15)' },
};

export default function SkillsPage() {
    return (
        <main className="page">
            <div className="container">
                <div style={{ textAlign: 'center', marginBottom: 48 }}>
                    <h1 style={{ fontSize: '2.2rem', fontWeight: 900, color: 'var(--text-bright)', marginBottom: 8 }}>
                        🔧 Skills Ecosystem
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: 600, margin: '0 auto' }}>
                        Composable capabilities for autonomous agents. Install skills to expand what your agent can do — trade, coordinate, identify, and transact.
                    </p>
                </div>

                {/* Day 1 / Week 1 / Month 1 */}
                <div className="card" style={{ marginBottom: 48, padding: 32, textAlign: 'center' }}>
                    <h3 style={{ color: 'var(--text-bright)', marginBottom: 24 }}>Recommended Setup Path</h3>
                    <div className="grid-3">
                        {[
                            ['Day 1', '🚀', ['ClawDotPump (launch)', 'Bankr (wallet)', 'ERC-8004 (identity)']],
                            ['Week 1', '📈', ['Jupiter (swaps)', 'Kamino (DeFi)', 'OpenRouter (self-fund)', 'Neynar (social)']],
                            ['Month 1', '🏛️', ['Coinbase Commerce', 'Holyheld (real-world)', 'Squads (multi-sig)', 'Prediction Markets']],
                        ].map(([period, emoji, items]) => (
                            <div key={period} style={{ textAlign: 'left' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                    <span style={{ fontSize: '1.5rem' }}>{emoji}</span>
                                    <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{period}</span>
                                </div>
                                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {items.map(item => (
                                        <li key={item} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>→ {item}</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Skill Categories */}
                {Object.entries(SKILLS).map(([category, skills]) => (
                    <div key={category} style={{ marginBottom: 48 }}>
                        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-bright)', marginBottom: 20 }}>{category}</h2>
                        <div className="grid-3">
                            {skills.map((skill) => {
                                const colors = iconColors[skill.color];
                                return (
                                    <a key={skill.name} href={skill.link} target="_blank" rel="noopener" className="card feature-card skill-card" style={{ textDecoration: 'none' }}>
                                        <div className="feature-icon" style={{ background: colors.bg, borderColor: colors.border }}>
                                            {skill.icon}
                                        </div>
                                        <h3>{skill.name}</h3>
                                        <p>{skill.desc}</p>
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                ))}

                {/* Browse All */}
                <div className="card" style={{ textAlign: 'center', padding: 40 }}>
                    <h3 style={{ color: 'var(--text-bright)', marginBottom: 8 }}>Browse All Skills</h3>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
                        The full openclaw-skills library has dozens more capabilities.
                    </p>
                    <a href="https://github.com/BankrBot/openclaw-skills" target="_blank" rel="noopener" className="btn btn-primary">
                        View on GitHub →
                    </a>
                </div>
            </div>
        </main>
    );
}
