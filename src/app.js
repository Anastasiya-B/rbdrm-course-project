const express = require('express');
const OpenApiValidator = require('express-openapi-validator');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.json());

app.use(
  OpenApiValidator.middleware({
    apiSpec: path.join(__dirname, '../openapi/openapi.yaml'),
    validateRequests: true,
    validateResponses: true,
  }),
);

const products = [
  {
    id: 1,
    name: 'Mechanical Keyboard',
    price_cents: 260000,
  },
  {
    id: 2,
    name: 'Gaming Mouse',
    price_cents: 120000,
  },
];

const orders = [
  {
    id: 1,
    items: [
      {
        product_id: 1,
        quantity: 1,
      },
    ],
    total_cents: 260000,
    status: 'created',
  },
];

const idempotencyStore = new Map();

app.get('/products', (req, res) => {
  res.json({
    items: products,
    next_cursor: null,
  });
});

app.get('/products/:id', (req, res) => {
  const product = products.find(item => item.id === Number(req.params.id));

  if (!product) {
    return res.status(404).type('application/problem+json').json({
      type: 'https://example.com/problems/not-found',
      title: 'Not found',
      status: 404,
      detail: 'Product not found.',
      instance: req.originalUrl,
    });
  }

  res.json(product);
});

app.get('/orders', (req, res) => {
  res.json({
    items: orders,
    next_cursor: null,
  });
});

app.get('/orders/:id', (req, res) => {
  const order = orders.find(item => item.id === Number(req.params.id));

  if (!order) {
    return res.status(404).type('application/problem+json').json({
      type: 'https://example.com/problems/not-found',
      title: 'Not found',
      status: 404,
      detail: 'Order not found.',
      instance: req.originalUrl,
    });
  }

  res.json(order);
});

app.post('/orders', (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  const requestBody = JSON.stringify(req.body);

  const storedRequest = idempotencyStore.get(idempotencyKey);

  if (storedRequest) {
    if (storedRequest.body !== requestBody) {
      return res.status(422).type('application/problem+json').json({
        type: 'https://example.com/problems/idempotency-conflict',
        title: 'Unprocessable entity',
        status: 422,
        detail:
          'The same Idempotency-Key cannot be reused with a different request body.',
        instance: req.originalUrl,
      });
    }

    return res.status(201).json(storedRequest.order);
  }

  const totalCents = req.body.items.reduce((total, item) => {
    const product = products.find(product => product.id === item.product_id);

    if (!product) {
      return total;
    }

    return total + product.price_cents * item.quantity;
  }, 0);

  const newOrder = {
    id: orders.length + 1,
    items: req.body.items,
    total_cents: totalCents,
    status: 'created',
  };

  orders.push(newOrder);

  idempotencyStore.set(idempotencyKey, {
    body: requestBody,
    order: newOrder,
  });

  res.status(201).json(newOrder);
});

app.use((err, req, res, next) => {
  const status = err.status || 500;

  let title = 'Internal server error';

  if (status === 400) {
    title = 'Validation error';
  } else if (status === 404) {
    title = 'Not found';
  } else if (status === 422) {
    title = 'Unprocessable entity';
  }

  res.status(status).type('application/problem+json').json({
    type: 'https://example.com/problems/validation-error',
    title,
    status,
    detail: err.message,
    instance: req.originalUrl,
  });
});

app.listen(port, () => {
  console.log(`Marketplace API is running on http://localhost:${port}`);
});
