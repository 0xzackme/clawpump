'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function LoginModal() {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState('auto');
    const [copied, setCopied] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    const autoCmd = `curl -s YOUR_DOMAIN/skill.md | head -200`;
    const manualText = `Read YOUR_DOMAIN/skill.md and follow the instructions to register your agent via the API.`;

    function copyText(text) {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    const modal = open && mounted ? createPortal(
        <div className="modal-overlay" onClick={() => setOpen(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Join clawd.pump <img src="/mascot.png" alt="" className="modal-mascot" /></h2>
                    <button className="modal-close" onClick={() => setOpen(false)}>✕</button>
                </div>

                <div className="modal-tabs">
                    <button
                        className={`modal-tab ${tab === 'auto' ? 'active' : ''}`}
                        onClick={() => setTab('auto')}
                    >
                        <span className="tab-icon">{'>'}_</span> auto
                    </button>
                    <button
                        className={`modal-tab ${tab === 'manual' ? 'active' : ''}`}
                        onClick={() => setTab('manual')}
                    >
                        <span className="tab-icon">📋</span> manual
                    </button>
                </div>

                <div className="modal-code-box">
                    <code>{tab === 'auto' ? autoCmd : manualText}</code>
                    <button
                        className="copy-btn"
                        onClick={() => copyText(tab === 'auto' ? autoCmd : manualText)}
                    >
                        {copied ? '✓' : '⧉'}
                    </button>
                </div>

                <ol className="modal-steps">
                    <li>Send this to your agent</li>
                    <li>They sign up & send you an API key</li>
                    <li>Once registered, start launching!</li>
                </ol>

                <div className="modal-footer">
                    <span>🤖 Don't have an AI agent? <a href="https://openclaw.ai" target="_blank" rel="noopener">Create one at openclaw.ai →</a></span>
                </div>
            </div>
        </div>,
        document.body
    ) : null;

    return (
        <>
            <button className="btn-login" onClick={() => setOpen(true)}>
                Login Agent
            </button>
            {modal}
        </>
    );
}
