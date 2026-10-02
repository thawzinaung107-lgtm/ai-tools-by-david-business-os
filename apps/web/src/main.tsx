import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:10000';

type QueueCardProps = { label: string; value: string; tone: 'cyan' | 'gold' | 'violet' | 'navy' };
type Summary = {
  new_inquiries: number;
  payment_proofs_waiting: number;
  delivery_pending: number;
  open_warranty_cases: number;
  orders_today: number;
  verified_revenue_today: string;
};
type Variation = {
  sku: string;
  name: string;
  retail_price: string;
  currency_code: string;
  status: string;
};
type Product = {
  master_sku: string;
  name: string;
  short_description: string;
  status: string;
  delivery_method: string;
  warranty_summary: string;
  variations: Variation[];
};

function QueueCard({ label, value, tone }: QueueCardProps) {
  return (
    <div className={`queue-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatMoney(value: string | number) {
  return new Intl.NumberFormat('en-US').format(Number(value ?? 0));
}

function App() {
  const [apiStatus, setApiStatus] = React.useState('Checking API…');
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [loadError, setLoadError] = React.useState('');

  React.useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [healthResponse, summaryResponse, productsResponse] = await Promise.all([
          fetch(`${apiBase}/health`),
          fetch(`${apiBase}/api/v1/dashboard/summary`),
          fetch(`${apiBase}/api/v1/products`),
        ]);
        if (!healthResponse.ok || !summaryResponse.ok || !productsResponse.ok) {
          throw new Error('API request failed');
        }
        const summaryPayload = await summaryResponse.json();
        const productsPayload = await productsResponse.json();
        setSummary(summaryPayload.data);
        setProducts(productsPayload.data);
        setApiStatus('API connected');
      } catch {
        setApiStatus('API unavailable');
        setLoadError('Live operational data could not be loaded. Check the API connection.');
      }
    };
    void loadDashboard();
  }, []);

  const queue = {
    newInquiries: summary?.new_inquiries ?? 0,
    paymentProofs: summary?.payment_proofs_waiting ?? 0,
    deliveryPending: summary?.delivery_pending ?? 0,
    warrantyCases: summary?.open_warranty_cases ?? 0,
  };

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
        <div className="sidebar-footer">MVP operations console</div>
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

        {loadError && <div className="error-banner" role="alert">{loadError}</div>}

        <section className="queue-grid" aria-label="Today’s queues">
          <QueueCard label="New inquiries" value={String(queue.newInquiries)} tone="cyan" />
          <QueueCard label="Payment proofs waiting" value={String(queue.paymentProofs)} tone="gold" />
          <QueueCard label="Paid / delivery pending" value={String(queue.deliveryPending)} tone="violet" />
          <QueueCard label="Open warranty cases" value={String(queue.warrantyCases)} tone="navy" />
        </section>

        <section className="summary-strip" aria-label="Today’s business summary">
          <div><span>Orders today</span><strong>{summary?.orders_today ?? 0}</strong></div>
          <div><span>Verified revenue today</span><strong>{formatMoney(summary?.verified_revenue_today ?? 0)} MMK</strong></div>
          <div><span>Catalog products</span><strong>{products.length}</strong></div>
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
              <strong>{queue.paymentProofs === 0 ? 'No payment proofs are waiting.' : `${queue.paymentProofs} proof(s) need review.`}</strong>
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
              <strong>{summary?.orders_today ? `${summary.orders_today} order(s) created today.` : 'No orders today.'}</strong>
              <span>Order detail views and CS handoff actions are the next module in the build.</span>
            </div>
          </div>
        </section>

        <section className="panel catalog-panel" id="products">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CATALOG</p>
              <h2>Product Catalog</h2>
            </div>
            <span className="catalog-note">English product descriptions • Owner approval required</span>
          </div>
          <div className="product-table-wrap">
            <table className="product-table">
              <thead>
                <tr><th>Product</th><th>Access options</th><th>Retail price</th><th>Status</th></tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.master_sku}>
                    <td><strong>{product.name}</strong><span>{product.short_description}</span></td>
                    <td>{product.variations.map((variation) => <span className="option-chip" key={variation.sku}>{variation.name}</span>)}</td>
                    <td>{product.variations.map((variation) => <span className="price-line" key={variation.sku}>{variation.name}: {formatMoney(variation.retail_price)} {variation.currency_code}</span>)}</td>
                    <td><span className={`status-pill ${product.status.toLowerCase()}`}>{product.status}</span></td>
                  </tr>
                ))}
                {products.length === 0 && <tr><td colSpan={4} className="table-empty">No products returned from the API.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="footer-note">
          <span>Render-ready MVP operations console</span>
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
