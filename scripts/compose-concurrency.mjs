import { execFileSync } from 'node:child_process';

const api = process.env.API_URL ?? 'http://127.0.0.1:3300';
const project = process.env.COMPOSE_PROJECT_NAME ?? 'marketplace-course';

function sql(query) {
  return Number(execFileSync('docker', ['compose', '-p', project, 'exec', '-T', 'postgres', 'psql', '-U', 'marketplace', '-d', 'marketplace', '-Atc', query], { encoding: 'utf8' }).trim());
}
async function call(path, options = {}) {
  const response = await fetch(`${api}${path}`, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}
function assert(value, message) { if (!value) throw new Error(message); }

async function login(email) {
  const result = await call('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123!' }) });
  assert(result.status === 200, `login failed for ${email}: ${result.status}`);
  return result.body.accessToken;
}

const seller = await login('oleh@example.com');
const buyer = await login('anna@example.com');
const created = await call('/products', {
  method: 'POST',
  headers: { authorization: `Bearer ${seller}`, 'content-type': 'application/json' },
  body: JSON.stringify({ name: `Concurrency-${Date.now()}`, description: 'isolated verification', price: 100, stockQuantity: 20 }),
});
assert(created.status === 201, `product creation failed: ${created.status}`);
const productId = Number(created.body.id);
const beforeOrders = sql('SELECT count(*) FROM orders');
const beforeOutbox = sql("SELECT count(*) FROM outbox_messages WHERE type = 'order.placed'");

const results = await Promise.all(Array.from({ length: 50 }, (_, index) => call('/orders', {
  method: 'POST',
  headers: { authorization: `Bearer ${buyer}`, 'content-type': 'application/json', 'idempotency-key': `compose-concurrency-${Date.now()}-${index}` },
  body: JSON.stringify({ items: [{ product_id: productId, quantity: 1 }] }),
})));
const successful = results.filter(result => result.status === 201);
const rejected = results.filter(result => result.status === 409);
const afterOrders = sql('SELECT count(*) FROM orders');
const afterOutbox = sql("SELECT count(*) FROM outbox_messages WHERE type = 'order.placed'");
const purchased = sql(`SELECT coalesce(sum(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = ${productId}`);
const stock = sql(`SELECT stock_quantity FROM products WHERE id = ${productId}`);
const duplicateEffects = sql(`SELECT count(*) - count(DISTINCT order_id) FROM payment_operations WHERE order_id IN (SELECT id FROM orders WHERE id IN (SELECT order_id FROM order_items WHERE product_id = ${productId}))`);
const report = { initialStock: 20, requests: 50, successfulPurchases: successful.length, rejectedPurchases: rejected.length, finalStock: stock, persistedOrdersDelta: afterOrders - beforeOrders, checkoutOutboxDelta: afterOutbox - beforeOutbox, purchasedQuantity: purchased, overselling: Math.max(0, purchased - 20), duplicatePaymentEffects: Math.max(0, duplicateEffects) };
console.log(JSON.stringify(report));
assert(report.successfulPurchases === 20 && report.rejectedPurchases === 30 && report.finalStock === 0 && report.persistedOrdersDelta === 20 && report.checkoutOutboxDelta === 20 && report.purchasedQuantity === 20 && report.overselling === 0 && report.duplicatePaymentEffects === 0, 'concurrency invariant failed');
