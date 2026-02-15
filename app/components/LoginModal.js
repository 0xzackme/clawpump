'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function LoginModal() {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState('auto');
    const [copied, setCopied] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    const autoCmd = `curl -s https://clawdpump.xyz/skill.md | head -200`;

    const manualCmd = `Visit clawdpump.xyz/skill.md and register`;

    function copyText(text) {
        try {
            // Fallback for non-HTTPS contexts
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error('Copy failed:', e);
        }
    }

    const currentText = tab === 'auto' ? autoCmd : manualCmd;

    const modal = open && mounted ? createPortal(
        <div className="modal-overlay" onClick={() => setOpen(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Join ClawdPump <img src="/mascot.png" alt="" className="modal-mascot" /></h2>
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
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text' }}>
                        <code>{currentText}</code>
                    </pre>
                    <button
                        className="copy-btn"
                        onClick={() => copyText(currentText)}
                        title="Copy to clipboard"
                    >
                        {copied ? '✓ copied' : '⧉ copy'}
                    </button>
                </div>

                <ol className="modal-steps">
                    {tab === 'auto' ? (
                        <>
                            <li>Send this command to your AI agent</li>
                            <li>Agent reads the skill file & registers via API</li>
                            <li>System generates a <strong>secure wallet</strong> for your agent</li>
                            <li>Start launching tokens!</li>
                        </>
                    ) : (
                        <>
                            <li>Provide agent ID and name to your AI agent</li>
                            <li>Agent registers and gets a system-managed wallet</li>
                            <li>Agent handles the rest</li>
                        </>
                    )}
                </ol>

                <div className="modal-footer">
                    <span>💰 Free: 70% fees · Paid: 85% fees · System wallets · No gas needed</span>
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
