# Marketplace API

Course project for Node.js.

## Homework 09

This homework uses **Option B — runtime validation** with:

- Express 4
- express-openapi-validator
- OpenAPI 3.0.3
- Redocly CLI

The OpenAPI specification is the source of truth for requests and responses.

## Install

```bash
npm install
```

## Start

```bash
npm start
```

Server runs on:

```text
http://localhost:3000
```

## OpenAPI validation

```bash
npx @redocly/cli lint openapi/openapi.yaml
```

Bundle the specification:

```bash
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
```

Check number of operations, resources and Idempotency-Key:

```bash
node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('operations:',ops.length,'resources:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'description length =',(idem?.description??'').trim().length)"
```

Check cursor pagination:

```bash
grep -c 'next_cursor' openapi/openapi.yaml
```

Check problem+json responses:

```bash
grep -c 'application/problem+json' openapi/openapi.yaml
```

## Runtime validation checks

Start the server:

```bash
npm start
```

### Missing Idempotency-Key

```bash
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"items":[{"product_id":1,"quantity":1}]}'
```

Expected result:

```text
400 Bad Request
Content-Type: application/problem+json
```

Validation detail:

```text
request/headers must have required property 'idempotency-key'
```

### Invalid request body

```bash
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-123" \
  -d '{"items":[]}'
```

Expected validation detail:

```text
request/body/items must NOT have fewer than 1 items
```

### Valid order

```bash
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-123" \
  -d '{"items":[{"product_id":1,"quantity":1}]}'
```

Expected result:

```text
201 Created
```

## API resources

The API contains two resources:

- `/products`
- `/orders`

Implemented operations:

- `GET /products`
- `GET /products/{id}`
- `GET /orders`
- `GET /orders/{id}`
- `POST /orders`
