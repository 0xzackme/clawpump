'use client';
import LoginModal from './LoginModal';

export default function NavBar() {
    return (
        <nav className="navbar">
            <div className="container">
                <a href="/" className="nav-logo">
                    <img src="/mascot.png" alt="clawd.pump" className="logo-icon" />
                    <span className="logo-text">clawd<span className="accent">.</span>pump</span>
                    <span className="nav-badge">beta</span>
                </a>
                <div className="nav-right">
                    <ul className="nav-links">
                        <li><a href="/docs">docs</a></li>
                    </ul>
                    <LoginModal />
                </div>
            </div>
        </nav>
    );
}
