import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:10000';
const tokenKey = 'atd_access_token';

type QueueCardProps = { label: string; value: string; tone: 'cyan' | 'gold' | 'violet' | 'navy' };
type User = { id: string; email: string; display_name: string; roles: string[]; permissions: string[] };
type Summary = {
  new_inquiries: number;
  payment_proofs_waiting: number;
  delivery_pending: number;
  open_warranty_cases: number;
  orders_today: number;
  verified_revenue_today: string;
};
type Variation = { sku: string; name: string; retail_price: string; currency_code: string; status: string };
type Product = {
  master_sku: string;
  name: string;
  short_description: string;
  status: string;
  delivery_method: string;
  warranty_summary: string;
  variations: Variation[];
};

type AuthResponse = { access_token: string; user: User };

function QueueCard({ label, value, tone }: QueueCardProps) {
  return <div className={`queue-card ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function formatMoney(value: string | number) {
  return new Intl.NumberFormat('en-US').format(Number(value ?? 0));
}

async function apiRequest(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

function AuthView({ onAuthenticated }: { onAuthenticated: (response: AuthResponse) => void }) {
  const [mode, setMode] = React.useState<'login' | 'bootstrap'>('login');
  const [email, setEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [bootstrapSecret, setBootstrapSecret] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = mode === 'login'
        ? await apiRequest('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
        : await apiRequest('/api/v1/auth/bootstrap', { method: 'POST', body: JSON.stringify({ email, display_name: displayName, password, bootstrap_secret: bootstrapSecret }) });
      onAuthenticated(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to authenticate');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">AD</div>
        <p className="eyebrow cyan">AI TOOLS BY DAVID</p>
        <h1>{mode === 'login' ? 'Sign in to Business OS' : 'Create Owner account'}</h1>
        <p className="auth-subtitle">Use your assigned role to access customer, order, payment, and delivery workflows.</p>
        <form onSubmit={submit}>
          {mode === 'bootstrap' && <label>Owner display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="David" required /></label>}
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@example.com" autoComplete="email" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
          {mode === 'bootstrap' && <label>One-time bootstrap secret<input type="password" value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} placeholder="Provided by system owner" required /></label>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create Owner account'}</button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'bootstrap' : 'login'); setError(''); }}>
          {mode === 'login' ? 'First-time setup: create Owner account' : 'Back to staff login'}
        </button>
        <p className="auth-footnote">Passwords are hashed server-side. Never share payment credentials, OTPs, or provider passwords with staff.</p>
      </section>
    </main>
  );
}

function App() {
  const [user, setUser] = React.useState<User | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);

  const authenticated = React.useCallback((response: AuthResponse) => {
    localStorage.setItem(tokenKey, response.access_token);
    setUser(response.user);
  }, []);

  React.useEffect(() => {
    const token = localStorage.getItem(tokenKey);
    if (!token) { setAuthLoading(false); return; }
    apiRequest('/api/v1/auth/me', {}, token)
      .then((payload) => setUser(payload.user))
      .catch(() => localStorage.removeItem(tokenKey))
      .finally(() => setAuthLoading(false));
  }, []);

  if (authLoading) return <main className="auth-shell"><div className="auth-loading">Checking secure session…</div></main>;
  if (!user) return <AuthView onAuthenticated={authenticated} />;
  return <Dashboard user={user} onSignOut={() => { localStorage.removeItem(tokenKey); setUser(null); }} />;
}

function Dashboard({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const token = localStorage.getItem(tokenKey) ?? '';
  const [apiStatus, setApiStatus] = React.useState('Loading live data…');
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [loadError, setLoadError] = React.useState('');

  React.useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [summaryPayload, productsPayload] = await Promise.all([
          apiRequest('/api/v1/dashboard/summary', {}, token),
          apiRequest('/api/v1/products', {}, token),
        ]);
        setSummary(summaryPayload.data);
        setProducts(productsPayload.data);
        setApiStatus('API connected');
      } catch (error) {
        if (error instanceof Error && error.message.includes('Authentication')) onSignOut();
        setApiStatus('API unavailable');
        setLoadError(error instanceof Error ? error.message : 'Live operational data could not be loaded.');
      }
    };
    void loadDashboard();
  }, [token, onSignOut]);

  const queue = {
    newInquiries: summary?.new_inquiries ?? 0,
    paymentProofs: summary?.payment_proofs_waiting ?? 0,
    deliveryPending: summary?.delivery_pending ?? 0,
    warrantyCases: summary?.open_warranty_cases ?? 0,
  };
  const nav = [
    ['Dashboard', 'dashboard.read', '#dashboard'], ['My Inbox', 'customers.read', '#inbox'], ['Customers', 'customers.read', '#customers'],
    ['Orders', 'orders.read', '#orders'], ['Payment Verification', 'payments.verify', '#payments'], ['Delivery Queue', 'delivery.read', '#delivery'],
    ['Products', 'products.read', '#products'], ['Warranty Cases', 'warranty.read', '#tickets'], ['Renewals', 'orders.read', '#renewals'], ['Reports', 'reports.read', '#reports'],
  ] as const;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">AD</div>
        <div className="brand-copy"><strong>AI Tools By David</strong><span>Business OS</span></div>
        <nav aria-label="Main navigation">{nav.filter(([, permission]) => user.permissions.includes(permission)).map(([label, , href], index) => <a className={index === 0 ? 'active' : ''} href={href} key={label}>{label}</a>)}</nav>
        <div className="sidebar-footer">{user.roles.join(' / ')} access</div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div><p className="eyebrow">{user.roles.join(' / ')} WORKSPACE</p><h1>Operations Dashboard</h1></div>
          <div className="topbar-actions"><span className={`connection-dot ${apiStatus === 'API connected' ? 'online' : ''}`}></span><span>{apiStatus}</span><span className="user-label">{user.display_name}</span><button className="avatar" aria-label="Sign out" onClick={onSignOut}>↪</button></div>
        </header>
        <section className="hero-note" aria-label="System safety rule"><div><p className="eyebrow cyan">PAYMENT CONTROL</p><h2>Payment Proof is not Payment Verification.</h2><p>Only Owner/Operations can verify a payment. Delivery becomes available only after the order is marked verified.</p></div><span className="shield">✓</span></section>
        {loadError && <div className="error-banner" role="alert">{loadError}</div>}
        <section className="queue-grid" aria-label="Today’s queues"><QueueCard label="New inquiries" value={String(queue.newInquiries)} tone="cyan" /><QueueCard label="Payment proofs waiting" value={String(queue.paymentProofs)} tone="gold" /><QueueCard label="Paid / delivery pending" value={String(queue.deliveryPending)} tone="violet" /><QueueCard label="Open warranty cases" value={String(queue.warrantyCases)} tone="navy" /></section>
        <section className="summary-strip" aria-label="Today’s business summary"><div><span>Orders today</span><strong>{summary?.orders_today ?? 0}</strong></div><div><span>Verified revenue today</span><strong>{formatMoney(summary?.verified_revenue_today ?? 0)} MMK</strong></div><div><span>Catalog products</span><strong>{products.length}</strong></div></section>
        <section className="content-grid"><div className="panel"><div className="panel-heading"><div><p className="eyebrow">OWNER ACTION</p><h2>Payment Verification Queue</h2></div><button className="ghost-button">Open queue</button></div><div className="empty-state"><div className="empty-icon">✓</div><strong>{queue.paymentProofs === 0 ? 'No payment proofs are waiting.' : `${queue.paymentProofs} proof(s) need review.`}</strong><span>Verified and rejected proofs will appear here with a full audit trail.</span></div></div><div className="panel"><div className="panel-heading"><div><p className="eyebrow">OPERATIONS</p><h2>Recent Orders</h2></div><button className="ghost-button">View all</button></div><div className="empty-state compact"><div className="empty-icon">+</div><strong>{summary?.orders_today ? `${summary.orders_today} order(s) created today.` : 'No orders today.'}</strong><span>Order detail views and CS handoff actions are the next module in the build.</span></div></div></section>
        <section className="panel catalog-panel" id="products"><div className="panel-heading"><div><p className="eyebrow">CATALOG</p><h2>Product Catalog</h2></div><span className="catalog-note">English product descriptions • Owner approval required</span></div><div className="product-table-wrap"><table className="product-table"><thead><tr><th>Product</th><th>Access options</th><th>Retail price</th><th>Status</th></tr></thead><tbody>{products.map((product) => <tr key={product.master_sku}><td><strong>{product.name}</strong><span>{product.short_description}</span></td><td>{product.variations.map((variation) => <span className="option-chip" key={variation.sku}>{variation.name}</span>)}</td><td>{product.variations.map((variation) => <span className="price-line" key={variation.sku}>{variation.name}: {formatMoney(variation.retail_price)} {variation.currency_code}</span>)}</td><td><span className={`status-pill ${product.status.toLowerCase()}`}>{product.status}</span></td></tr>)}{products.length === 0 && <tr><td colSpan={4} className="table-empty">No products returned from the API.</td></tr>}</tbody></table></div></section>
        <footer className="footer-note"><span>Render-ready MVP operations console</span><span>•</span><span>Signed in as {user.email}</span></footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
