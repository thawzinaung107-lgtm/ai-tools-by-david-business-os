import React from 'react';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:10000';

type Proof = {
  id: string;
  public_code: string;
  order_code: string;
  customer_name: string;
  claimed_amount: string;
  order_total: string;
  transaction_reference: string;
  transaction_at?: string;
  status: string;
  payment_method_name: string;
  original_filename?: string;
  mime_type?: string;
  byte_size?: number;
};
type Analytics = {
  range_days: number;
  kpis: { order_count: number; verified_order_count: number; rejected_payment_count: number; verified_revenue: string; average_verified_order_value: string; new_customer_count: number };
  daily: Array<{ date: string; order_count: number; verified_revenue: string }>;
  top_products: Array<{ product_name: string; units_sold: number; verified_revenue: string }>;
  payment_breakdown: Array<{ status: string; count: number }>;
};

async function apiRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = localStorage.getItem('atd_access_token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

function money(value: string | number) { return new Intl.NumberFormat('en-US').format(Number(value ?? 0)); }
function shortDate(value: string) { return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'; }

export function OwnerControlCenter({ canVerify, canReport }: { canVerify: boolean; canReport: boolean }) {
  const [proofs, setProofs] = React.useState<Proof[]>([]);
  const [analytics, setAnalytics] = React.useState<Analytics | null>(null);
  const [rangeDays, setRangeDays] = React.useState(30);
  const [reviewId, setReviewId] = React.useState('');
  const [reviewNote, setReviewNote] = React.useState('');
  const [rejectReason, setRejectReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [storageStatus, setStorageStatus] = React.useState('');

  const loadProofs = React.useCallback(async () => {
    try {
      const payload = await apiRequest('/api/v1/payment-proofs?status=PROOF_RECEIVED&limit=50');
      setProofs(payload.data);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load payment proofs'); }
  }, []);
  const loadAnalytics = React.useCallback(async () => {
    if (!canReport) return;
    try {
      const payload = await apiRequest(`/api/v1/dashboard/analytics?range_days=${rangeDays}`);
      setAnalytics(payload.data);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load analytics'); }
  }, [canReport, rangeDays]);

  React.useEffect(() => { void loadProofs(); }, [loadProofs]);
  React.useEffect(() => { void loadAnalytics(); }, [loadAnalytics]);

  const review = async (action: 'verify' | 'reject') => {
    if (!reviewId || !canVerify) return;
    if (action === 'reject' && rejectReason.trim().length < 3) { setError('Rejection reason is required.'); return; }
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/v1/payment-proofs/${reviewId}/${action}`, { method: 'POST', body: JSON.stringify(action === 'verify' ? { review_note: reviewNote || undefined } : { rejection_reason: rejectReason, review_note: reviewNote || undefined }) });
      setProofs((current) => current.filter((proof) => proof.id !== reviewId));
      setReviewId(''); setReviewNote(''); setRejectReason('');
      await loadAnalytics();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to review payment proof'); }
    finally { setBusy(false); }
  };

  const openProof = async (proofId: string) => {
    try {
      const payload = await apiRequest(`/api/v1/payment-proofs/${proofId}/view-url`);
      window.open(payload.data.url, '_blank', 'noopener,noreferrer');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to open proof'); }
  };

  const runStorageTest = async () => {
    setBusy(true); setError(''); setStorageStatus('Running private storage put/delete test…');
    try {
      const payload = await apiRequest('/api/v1/storage/smoke-test', { method: 'POST' });
      setStorageStatus(`Storage PASS · ${payload.data.byteSize} bytes written and cleaned up`);
    } catch (requestError) {
      setStorageStatus('');
      setError(requestError instanceof Error ? requestError.message : 'Storage smoke test failed');
    } finally { setBusy(false); }
  };

  const maxRevenue = Math.max(...(analytics?.daily ?? []).map((day) => Number(day.verified_revenue)), 1);
  return <section className="owner-control-center" id="payments">
    <div className="owner-section-heading"><div><p className="eyebrow cyan">OWNER CONTROL CENTER</p><h2>Payment Verification & Analytics</h2><span>Payment decisions, delivery release, and performance signals in one place.</span>{storageStatus && <small className="storage-status">{storageStatus}</small>}</div><div className="owner-refresh"><button className="ghost-button" onClick={() => void loadProofs()}>Refresh queue</button><button className="ghost-button" disabled={busy} onClick={() => void runStorageTest()}>Test storage</button>{canReport && <select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>}</div></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="owner-grid">
      <div className="owner-panel proof-panel"><div className="panel-heading"><div><p className="eyebrow">PAYMENT QUEUE</p><h3>Proofs waiting for review</h3></div><span className="queue-count">{proofs.length}</span></div>{proofs.length === 0 ? <div className="owner-empty"><div className="empty-icon">✓</div><strong>Queue is clear</strong><span>No payment proof is waiting for Owner review.</span></div> : <div className="proof-table-wrap"><table className="proof-table"><thead><tr><th>Customer / Order</th><th>Amount</th><th>Transaction</th><th>Proof</th><th>Action</th></tr></thead><tbody>{proofs.map((proof) => <tr key={proof.id}><td><strong>{proof.customer_name}</strong><span>{proof.order_code} • {proof.payment_method_name}</span></td><td><strong>{money(proof.claimed_amount)} MMK</strong><span>{shortDate(proof.transaction_at || '')}</span></td><td><span>{proof.transaction_reference}</span></td><td><button className="link-button" onClick={() => void openProof(proof.id)}>{proof.original_filename || 'View file'}</button></td><td><button className="review-button" onClick={() => { setReviewId(proof.id); setReviewNote(''); setRejectReason(''); }}>Review</button></td></tr>)}</tbody></table></div>}
        {reviewId && canVerify && <div className="review-drawer"><div><p className="eyebrow">REVIEW SELECTED PROOF</p><h3>Confirm payment decision</h3></div><label>Review note<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Optional internal note" rows={2} /></label><label>Rejection reason <span className="muted">(required only for Reject)</span><textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Explain what the customer must correct" rows={2} /></label><div className="review-actions"><button className="approve-button" disabled={busy} onClick={() => void review('verify')}>{busy ? 'Saving…' : 'Verify & release delivery'}</button><button className="reject-button" disabled={busy} onClick={() => void review('reject')}>Reject proof</button><button className="ghost-button" onClick={() => setReviewId('')}>Cancel</button></div></div>}
      </div>
      {canReport && <div className="owner-panel analytics-panel" id="reports"><div className="panel-heading"><div><p className="eyebrow">BUSINESS SIGNALS</p><h3>Performance snapshot</h3></div><span className="range-label">Last {rangeDays} days</span></div>{analytics ? <><div className="analytics-kpis"><div><span>Verified revenue</span><strong>{money(analytics.kpis.verified_revenue)} MMK</strong></div><div><span>Verified orders</span><strong>{analytics.kpis.verified_order_count}</strong></div><div><span>New customers</span><strong>{analytics.kpis.new_customer_count}</strong></div><div><span>Avg. order value</span><strong>{money(analytics.kpis.average_verified_order_value)}</strong></div></div><div className="mini-chart"><div className="chart-label"><span>Verified revenue by day</span><span>MMK</span></div><div className="bar-chart">{analytics.daily.map((day) => <div className="bar-column" key={day.date} title={`${day.date}: ${money(day.verified_revenue)} MMK`}><div className="bar" style={{ height: `${Math.max((Number(day.verified_revenue) / maxRevenue) * 100, Number(day.verified_revenue) > 0 ? 8 : 2)}%` }}></div><small>{new Date(day.date).getDate()}</small></div>)}</div></div><div className="analytics-lists"><div><div className="chart-label"><span>Top products</span><span>Units / revenue</span></div>{analytics.top_products.length === 0 ? <p className="muted">No verified product sales in this period.</p> : analytics.top_products.map((product) => <div className="product-signal" key={product.product_name}><span>{product.product_name}</span><strong>{product.units_sold} · {money(product.verified_revenue)} MMK</strong></div>)}</div><div><div className="chart-label"><span>Payment status</span><span>Orders</span></div>{analytics.payment_breakdown.map((item) => <div className="payment-signal" key={item.status}><span className={`status-pill ${item.status.toLowerCase()}`}>{item.status}</span><strong>{item.count}</strong></div>)}</div></div></> : <div className="owner-empty compact"><span>Loading analytics…</span></div>}</div>}
    </div>
  </section>;
}
