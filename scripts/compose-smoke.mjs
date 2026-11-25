const base = process.env.API_URL ?? 'http://127.0.0.1:3300';
const email = process.env.DEMO_EMAIL ?? 'anna@example.com';
const password = process.env.DEMO_PASSWORD ?? 'Password123!';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await request('/healthz');
assert(health.response.ok, `healthz failed: ${health.response.status}`);
const ready = await request('/readyz');
assert(ready.response.ok, `readyz failed: ${ready.response.status}`);

const login = await request('/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert(login.response.ok && login.body?.accessToken, `login failed: ${login.response.status}`);
const auth = { authorization: `Bearer ${login.body.accessToken}`, 'content-type': 'application/json' };

const products = await request('/products?limit=1', { headers: auth });
assert(products.response.ok && products.body?.items?.length, `product access failed: ${products.response.status}`);
const productId = products.body.items[0].id;
const key = `compose-smoke-${Date.now()}`;
const orderRequest = { product_id: Number(productId), quantity: 1 };
const created = await request('/orders', {
  method: 'POST', headers: { ...auth, 'Idempotency-Key': key }, body: JSON.stringify({ items: [orderRequest] }),
});
assert(created.response.status === 201, `order creation failed: ${created.response.status}`);
const orderId = created.body.id;

let paid = null;
for (let i = 0; i < 30; i += 1) {
  const current = await request(`/orders/${orderId}`, { headers: auth });
  if (current.response.ok && current.body?.status === 'paid') { paid = current.body; break; }
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert(paid, `order ${orderId} did not become paid within timeout`);

const replay = await request('/orders', {
  method: 'POST', headers: { ...auth, 'Idempotency-Key': key }, body: JSON.stringify({ items: [orderRequest] }),
});
assert(replay.response.ok && String(replay.body.id) === String(orderId), 'idempotency replay created a different order');
console.log(JSON.stringify({ health: health.response.status, ready: ready.response.status, orderId, status: paid.status, replayStatus: replay.response.status }));
