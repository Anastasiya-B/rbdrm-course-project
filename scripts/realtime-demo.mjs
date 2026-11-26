import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Password123!';
const OWNER_EMAIL = process.env.DEMO_EMAIL ?? 'anna@example.com';
const FOREIGN_EMAIL = process.env.FOREIGN_EMAIL ?? 'oleh@example.com';
const TIMEOUT_MS = 8000;

function timeoutPromise(promise, label, timeoutMs = TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : text; } catch { body = text; }
  return { response, body };
}

async function login(email) {
  const result = await request('/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (result.response.status !== 200 || !result.body?.accessToken) {
    throw new Error(`login failed for ${email}: ${result.response.status}`);
  }
  return result.body.accessToken;
}

function connect(token) {
  return io(BASE_URL, {
    transports: ['websocket'], auth: { token },
    reconnection: false, timeout: TIMEOUT_MS,
  });
}

function waitForConnection(socket) {
  if (socket.connected) return Promise.resolve();
  return timeoutPromise(new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  }), 'socket connection');
}

function join(socket, orderId) {
  return timeoutPromise(new Promise(resolve => {
    socket.emit('join', { orderId }, resolve);
  }), 'socket join');
}

async function createOrder(token) {
  const products = await request('/products?limit=1', {
    headers: { authorization: `Bearer ${token}` },
  });
  const product = products.body?.items?.[0];
  if (!product) throw new Error(`product lookup failed: ${products.response.status}`);
  const result = await request('/orders', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `realtime-demo-${Date.now()}-${Math.random()}`,
    },
    body: JSON.stringify({ items: [{ product_id: Number(product.id), quantity: 1 }] }),
  });
  if (result.response.status !== 201) throw new Error(`order creation failed: ${result.response.status}`);
  return result.body.id;
}

async function waitForPaid(token, orderId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await request(`/orders/${orderId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (result.body?.status === 'paid') return result.body;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('payment status timed out');
}

async function readSseReplay(token, orderId) {
  const response = await fetch(`${BASE_URL}/orders/${orderId}/events`, {
    headers: { authorization: `Bearer ${token}`, 'last-event-id': '0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok || !response.body) return false;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      if (text.includes('event: order.status') && text.includes('paid')) return true;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return false;
}

async function main() {
  const ownerToken = await login(OWNER_EMAIL);
  const foreignToken = await login(FOREIGN_EMAIL);
  const orderId = await createOrder(ownerToken);
  const owner = connect(ownerToken);
  const foreign = connect(foreignToken);
  const invalid = connect('not-a-jwt');
  let ownerReceived = 0;
  let foreignReceived = 0;
  owner.on('order.status', event => { if (event.orderId === orderId) ownerReceived += 1; });
  foreign.on('order.status', event => { if (event.orderId === orderId) foreignReceived += 1; });

  try {
    await Promise.all([waitForConnection(owner), waitForConnection(foreign), waitForConnection(invalid)]);
    const ownerJoin = await join(owner, orderId);
    const foreignJoin = await join(foreign, orderId);
    const invalidJoin = await join(invalid, orderId);
    const paid = await waitForPaid(ownerToken, orderId);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const replay = await readSseReplay(ownerToken, orderId);
    const result = {
      orderId, paidStatus: paid.status,
      ownerJoin: ownerJoin?.ok === true,
      foreignJoinRejected: foreignJoin?.ok === false,
      invalidJwtRejected: invalidJoin?.ok === false,
      ownerReceived: ownerReceived > 0, foreignReceived,
      sseReplayObserved: replay,
    };
    console.log(JSON.stringify(result));
    if (!result.ownerJoin || !result.foreignJoinRejected || !result.invalidJwtRejected ||
        !result.ownerReceived || result.foreignReceived !== 0 || !result.sseReplayObserved) process.exitCode = 1;
  } finally {
    owner.disconnect(); foreign.disconnect(); invalid.disconnect();
  }
}

await main();
