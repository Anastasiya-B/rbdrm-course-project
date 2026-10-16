import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SAME_ROOM = process.argv.includes('--same-room');

const ORDER_A = 1;
const ORDER_B = 2;

const USER_A = 1;
const USER_B = 2;

const roomBOrderId = SAME_ROOM ? ORDER_A : ORDER_B;
const roomBUserId = SAME_ROOM ? USER_A : USER_B;

const expectedBReceived = SAME_ROOM ? 1 : 0;

const JOIN_TIMEOUT_MS = 5000;
const EVENT_TIMEOUT_MS = 3000;

let aReceived = 0;
let bReceived = 0;

function connectClient(userId) {
  return io(BASE_URL, {
    transports: ['websocket'],
    auth: {
      userId,
    },
    reconnection: true,
    timeout: 5000,
  });
}

function waitForConnection(socket, label) {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} connection timed out`));
    }, JOIN_TIMEOUT_MS);

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const onConnectError = error => {
      cleanup();
      reject(new Error(`${label} connection failed: ${error.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    };

    socket.once('connect', onConnect);
    socket.once('connect_error', onConnectError);
  });
}

function joinOrder(socket, orderId, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} join timed out`));
    }, JOIN_TIMEOUT_MS);

    socket.emit(
      'join',
      {
        orderId,
      },
      response => {
        clearTimeout(timeout);

        if (!response?.ok) {
          reject(
            new Error(
              `${label} join failed: ${response?.error ?? 'unknown error'}`,
            ),
          );
          return;
        }

        resolve(response);
      },
    );
  });
}

async function getOrder(orderId) {
  const response = await fetch(`${BASE_URL}/orders/${orderId}`);

  if (!response.ok) {
    throw new Error(`GET /orders/${orderId} failed with ${response.status}`);
  }

  return response.json();
}

function getNextStatus(currentStatus) {
  const statuses = ['created', 'paid', 'shipped', 'completed', 'cancelled'];

  const currentIndex = statuses.indexOf(currentStatus);

  if (currentIndex === -1) {
    return 'paid';
  }

  return statuses[(currentIndex + 1) % statuses.length];
}

async function updateOrderStatus(orderId, status) {
  const response = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status,
    }),
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `PATCH /orders/${orderId}/status failed with ${response.status}: ${body}`,
    );
  }

  return response.json();
}

function waitForDeliveryWindow() {
  return new Promise(resolve => {
    setTimeout(resolve, EVENT_TIMEOUT_MS);
  });
}

async function main() {
  const clientA = connectClient(USER_A);
  const clientB = connectClient(roomBUserId);

  clientA.io.on('reconnect_attempt', attempt => {
    console.error(`A_RECONNECT_ATTEMPT=${attempt}`);
  });

  clientB.io.on('reconnect_attempt', attempt => {
    console.error(`B_RECONNECT_ATTEMPT=${attempt}`);
  });

  clientA.on('order.status', event => {
    if (event.orderId === ORDER_A) {
      aReceived = 1;
    }
  });

  clientB.on('order.status', event => {
    if (event.orderId === ORDER_A) {
      bReceived = 1;
    }
  });

  try {
    await Promise.all([
      waitForConnection(clientA, 'client A'),
      waitForConnection(clientB, 'client B'),
    ]);

    await Promise.all([
      joinOrder(clientA, ORDER_A, 'client A'),
      joinOrder(clientB, roomBOrderId, 'client B'),
    ]);

    const orderA = await getOrder(ORDER_A);

    const nextStatus = getNextStatus(orderA.status);

    await updateOrderStatus(ORDER_A, nextStatus);

    await waitForDeliveryWindow();

    console.log(`A_RECEIVED=${aReceived}`);
    console.log(`B_RECEIVED=${bReceived}`);

    const success = aReceived === 1 && bReceived === expectedBReceived;

    process.exitCode = success ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);

    console.log(`A_RECEIVED=${aReceived}`);
    console.log(`B_RECEIVED=${bReceived}`);

    process.exitCode = 1;
  } finally {
    clientA.disconnect();
    clientB.disconnect();
  }
}

await main();
