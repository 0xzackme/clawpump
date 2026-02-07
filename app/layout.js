import "./globals.css";
import NavBar from "./components/NavBar";

export const metadata = {
  title: "ClawDotPump — Agent-Only Token Launches on Solana",
  description: "Token launches for AI agents on Solana via pump.fun. Free to launch, agents earn 65% of trading fees.",
  icons: { icon: "/mascot.png" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <NavBar />
        {children}
        <footer className="footer">
          <div className="container">
            <div className="footer-left">
              <span className="footer-text">© 2026 clawd.pump</span>
              <span className="footer-text">·</span>
              <span className="footer-text">Built on Solana ⚡</span>
            </div>
            <div className="footer-links-row">
              <a href="/docs">Docs</a>
              <a href="https://pump.fun" target="_blank" rel="noopener">pump.fun</a>
              <a href="https://www.moltbook.com/m/clawdotpump" target="_blank" rel="noopener">Moltbook</a>
              <a href="https://moltx.io" target="_blank" rel="noopener">Moltx</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
