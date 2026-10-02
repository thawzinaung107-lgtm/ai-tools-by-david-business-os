import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:10000';

type QueueCardProps = { label: string; value: string; tone: 'cyan' | 'gold' | 'violet' | 'navy' };

function QueueCard({ label, value, tone }: QueueCardProps) {
  return (
    <div className={`queue-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function App() {
  const [apiStatus, setApiStatus] = React.useState('Checking API…');

  React.useEffect(() => {
    fetch(`${apiBase}/health`)
      .then((response) => response.json())
      .then(() => setApiStatus('API connected'))
      .catch(() => setApiStatus('API unavailable'));
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">AD</div>
        <div className="brand-copy">
          <strong>AI Tools By David</strong>
          <span>Business OS</span>
        </div>
        <nav aria-label="Main navigation">
          <a className="active" href="#dashboard">Dashboard</a>
          <a href="#inbox">My Inbox</a>
          <a href="#customers">Customers</a>
          <a href="#orders">Orders</a>
          <a href="#payments">Payment Verification</a>
          <a href="#delivery">Delivery Queue</a>
          <a href="#products">Products</a>
          <a href="#tickets">Warranty Cases</a>
          <a href="#renewals">Renewals</a>
          <a href="#reports">Reports</a>
        </nav>
        <div className="sidebar-footer">MVP scaffold</div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">OWNER WORKSPACE</p>
            <h1>Operations Dashboard</h1>
          </div>
          <div className="topbar-actions">
            <span className={`connection-dot ${apiStatus === 'API connected' ? 'online' : ''}`}></span>
            <span>{apiStatus}</span>
            <button className="avatar" aria-label="Account menu">O</button>
          </div>
        </header>

        <section className="hero-note" aria-label="System safety rule">
          <div>
            <p className="eyebrow cyan">PAYMENT CONTROL</p>
            <h2>Payment Proof is not Payment Verification.</h2>
            <p>Only Owner/Operations can verify a payment. Delivery becomes available only after the order is marked verified.</p>
          </div>
          <span className="shield">✓</span>
        </section>

        <section className="queue-grid" aria-label="Today’s queues">
          <QueueCard label="New inquiries" value="0" tone="cyan" />
          <QueueCard label="Payment proofs waiting" value="0" tone="gold" />
          <QueueCard label="Paid / delivery pending" value="0" tone="violet" />
          <QueueCard label="Open warranty cases" value="0" tone="navy" />
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">OWNER ACTION</p>
                <h2>Payment Verification Queue</h2>
              </div>
              <button className="ghost-button">Open queue</button>
            </div>
            <div className="empty-state">
              <div className="empty-icon">✓</div>
              <strong>No payment proofs are waiting.</strong>
              <span>Verified and rejected proofs will appear here with a full audit trail.</span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">OPERATIONS</p>
                <h2>Recent Orders</h2>
              </div>
              <button className="ghost-button">View all</button>
            </div>
            <div className="empty-state compact">
              <div className="empty-icon">+</div>
              <strong>No orders yet.</strong>
              <span>Orders will be created from a verified customer conversation.</span>
            </div>
          </div>
        </section>

        <footer className="footer-note">
          <span>Render-ready MVP scaffold</span>
          <span>•</span>
          <span>API: {apiBase}</span>
        </footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
