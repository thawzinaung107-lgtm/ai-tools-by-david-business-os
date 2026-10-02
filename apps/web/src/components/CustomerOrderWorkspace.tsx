import React from 'react';

const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:10000';

type Product = {
  name: string;
  variations: Array<{ id: string; name: string; retail_price: string; currency_code: string; status: string }>;
};
type Customer = {
  id: string;
  public_code: string;
  display_name: string;
  customer_type: string;
  phone?: string;
  email?: string;
  country_code?: string;
  language_code: string;
  order_count?: number;
  created_at: string;
};
type Order = {
  id: string;
  public_code: string;
  status: string;
  total_amount: string;
  currency_code: string;
  payment_status: string;
  delivery_status: string;
  created_at: string;
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

function money(value: string | number) {
  return new Intl.NumberFormat('en-US').format(Number(value ?? 0));
}

export function CustomerOrderWorkspace({ products }: { products: Product[] }) {
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null);
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [search, setSearch] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);
  const [customerForm, setCustomerForm] = React.useState({ display_name: '', customer_type: 'PERSONAL', phone: '', email: '' });
  const [orderForm, setOrderForm] = React.useState({ variationId: '', quantity: 1, paymentMethod: 'KBZPAY', discount: 0 });

  const loadCustomers = React.useCallback(async (query = '') => {
    try {
      const payload = await apiRequest(`/api/v1/customers?limit=50${query ? `&q=${encodeURIComponent(query)}` : ''}`);
      setCustomers(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load customers');
    }
  }, []);

  React.useEffect(() => { void loadCustomers(); }, [loadCustomers]);

  const selectCustomer = async (customer: Customer) => {
    setError('');
    setSelectedCustomer(customer);
    setOrderForm((current) => ({ ...current, variationId: current.variationId || products[0]?.variations[0]?.id || '' }));
    try {
      const [detailPayload, orderPayload] = await Promise.all([
        apiRequest(`/api/v1/customers/${customer.id}`),
        apiRequest(`/api/v1/orders?customer_id=${customer.id}&limit=20`),
      ]);
      setSelectedCustomer(detailPayload.data);
      setOrders(orderPayload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load customer detail');
    }
  };

  const createCustomer = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = await apiRequest('/api/v1/customers', { method: 'POST', body: JSON.stringify({ ...customerForm, phone: customerForm.phone || undefined, email: customerForm.email || undefined }) });
      setCustomers((current) => [payload.data, ...current]);
      setCustomerForm({ display_name: '', customer_type: 'PERSONAL', phone: '', email: '' });
      setShowCreate(false);
      await selectCustomer(payload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create customer');
    } finally { setBusy(false); }
  };

  const createOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCustomer || !orderForm.variationId) return;
    setBusy(true); setError('');
    try {
      await apiRequest('/api/v1/orders', { method: 'POST', body: JSON.stringify({ customer_id: selectedCustomer.id, items: [{ product_variation_id: orderForm.variationId, quantity: orderForm.quantity }], payment_method_code: orderForm.paymentMethod, discount_amount: Number(orderForm.discount) || 0 }) });
      const orderPayload = await apiRequest(`/api/v1/orders?customer_id=${selectedCustomer.id}&limit=20`);
      setOrders(orderPayload.data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create order');
    } finally { setBusy(false); }
  };

  const variations = products.flatMap((product) => product.variations.filter((variation) => variation.status !== 'ARCHIVED').map((variation) => ({ ...variation, productName: product.name })));

  return (
    <section className="workspace-section" id="customers">
      <div className="workspace-heading"><div><p className="eyebrow">CS WORKSPACE</p><h2>Customers & Order Creation</h2></div><button className="primary-small" onClick={() => setShowCreate((current) => !current)}>{showCreate ? 'Close form' : '+ New customer'}</button></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="customer-workspace">
        <div className="customer-list-panel">
          <div className="search-row"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, email" /><button className="ghost-button" onClick={() => void loadCustomers(search)}>Search</button></div>
          <div className="customer-list">{customers.map((customer) => <button className={`customer-row ${selectedCustomer?.id === customer.id ? 'selected' : ''}`} key={customer.id} onClick={() => void selectCustomer(customer)}><strong>{customer.display_name}</strong><span>{customer.public_code} • {customer.customer_type}</span><small>{customer.phone || customer.email || 'No contact added'}</small></button>)}{customers.length === 0 && <div className="table-empty">No customers found.</div>}</div>
        </div>
        <div className="customer-detail-panel">
          {showCreate && <form className="inline-form" onSubmit={createCustomer}><h3>Create customer</h3><div className="form-grid"><label>Name<input value={customerForm.display_name} onChange={(event) => setCustomerForm({ ...customerForm, display_name: event.target.value })} required /></label><label>Type<select value={customerForm.customer_type} onChange={(event) => setCustomerForm({ ...customerForm, customer_type: event.target.value })}><option value="PERSONAL">Personal</option><option value="BUSINESS">Business</option><option value="RESELLER">Reseller</option></select></label><label>Phone<input value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} /></label><label>Email<input type="email" value={customerForm.email} onChange={(event) => setCustomerForm({ ...customerForm, email: event.target.value })} /></label></div><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create customer'}</button></form>}
          {!showCreate && !selectedCustomer && <div className="workspace-empty"><div className="empty-icon">⌕</div><strong>Select a customer</strong><span>Choose a customer from the list to view their detail and create an order.</span></div>}
          {selectedCustomer && <>
            <div className="detail-header"><div><p className="eyebrow">CUSTOMER DETAIL</p><h3>{selectedCustomer.display_name}</h3><span>{selectedCustomer.public_code} • {selectedCustomer.customer_type}</span></div><span className="status-pill active">AUTHENTICATED CS VIEW</span></div>
            <div className="detail-facts"><div><span>Phone</span><strong>{selectedCustomer.phone || '—'}</strong></div><div><span>Email</span><strong>{selectedCustomer.email || '—'}</strong></div><div><span>Language</span><strong>{selectedCustomer.language_code}</strong></div><div><span>Orders</span><strong>{orders.length}</strong></div></div>
            <form className="order-form" onSubmit={createOrder}><div className="subheading"><div><p className="eyebrow">CS ACTION</p><h3>Create order</h3></div><span className="order-safety">Payment pending until Owner verifies proof</span></div><div className="form-grid order-grid"><label>Product / access option<select value={orderForm.variationId} onChange={(event) => setOrderForm({ ...orderForm, variationId: event.target.value })} required><option value="">Select product</option>{variations.map((variation) => <option key={variation.id} value={variation.id}>{variation.productName} — {variation.name} — {money(variation.retail_price)} {variation.currency_code}</option>)}</select></label><label>Quantity<input type="number" min="1" max="100" value={orderForm.quantity} onChange={(event) => setOrderForm({ ...orderForm, quantity: Number(event.target.value) })} /></label><label>Payment method<select value={orderForm.paymentMethod} onChange={(event) => setOrderForm({ ...orderForm, paymentMethod: event.target.value })}><option value="KBZPAY">KBZPay</option><option value="WAVEPAY">WavePay</option><option value="AYAPAY">AYA Pay</option></select></label><label>Discount (MMK)<input type="number" min="0" value={orderForm.discount} onChange={(event) => setOrderForm({ ...orderForm, discount: Number(event.target.value) })} /></label></div><button className="primary-button" type="submit" disabled={busy || !orderForm.variationId}>{busy ? 'Creating…' : 'Create payment-pending order'}</button></form>
            <div className="order-history"><div className="subheading"><div><p className="eyebrow">PURCHASE HISTORY</p><h3>Recent orders</h3></div></div>{orders.length === 0 ? <div className="table-empty">No orders for this customer yet.</div> : <div className="order-history-table"><table><thead><tr><th>Order</th><th>Total</th><th>Payment</th><th>Delivery</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.public_code}</strong><span>{new Date(order.created_at).toLocaleString()}</span></td><td>{money(order.total_amount)} {order.currency_code}</td><td><span className="status-pill draft">{order.payment_status}</span></td><td>{order.delivery_status}</td></tr>)}</tbody></table></div>}</div>
          </>}
        </div>
      </div>
    </section>
  );
}
