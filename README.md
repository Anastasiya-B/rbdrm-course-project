# Marketplace API

Course project for Node.js.

## Homework 09

This homework uses **Option B — runtime validation** with:

- Express 4
- express-openapi-validator
- OpenAPI 3.0.3
- Redocly CLI

The OpenAPI specification is the source of truth for requests and responses.

## Homework 11

This homework adds:

- typed environment configuration with Zod
- fail-fast startup validation
- `.env.example` synchronization check
- secrets outside git and Docker image
- PostgreSQL via Docker Compose
- database password from a secret file
- database password rotation without application restart

---

# Configuration

## Environment variables

All application environment variables are described in a single Zod schema:

```text
src/config/env.schema.ts
```

Current variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | HTTP port used by the application |
| `DB_URL` | Yes | — | PostgreSQL connection URL without password |
| `DB_PASSWORD_FILE` | No | `secrets/db_password` | Path to the PostgreSQL password secret file |

Example `.env`:

```env
PORT=3000
DB_URL=postgresql://marketplace@localhost:5432/marketplace
DB_PASSWORD_FILE=secrets/db_password
```

The real `.env` is ignored by git.

## Environment example contract

`.env.example` is committed to git and contains all variables from the Zod schema.

Check that `.env.example` is synchronized with the schema:

```bash
npm run check:env
```

Expected result:

```text
.env.example is synchronized with env schema.
```

If a variable is missing or extra, the command exits with code `1`.

## Fail-fast validation

Configuration is validated during application startup through `ConfigModule.forRoot`.

If a required variable is missing or invalid, the application does not start.

Example:

```bash
mv .env /tmp/.env
env -u DB_URL npm run start
echo $?
```

Expected output contains:

```text
Environment validation failed:
DB_URL
```

The exit code must be non-zero.

Restore the file:

```bash
mv /tmp/.env .
```

## Database secret

The PostgreSQL password is not stored in `.env`.

It is stored in:

```text
secrets/db_password
```

Create the initial secret file:

```bash
mkdir -p secrets
printf 'marketplace_password' > secrets/db_password
```

The `secrets/` directory is ignored by git and excluded from the Docker image.

## Install

```bash
npm install
```

## Start PostgreSQL

```bash
docker compose up -d
```

Check the container:

```bash
docker compose ps
```

## Start the application

```bash
npm start
```

The application runs on:

```text
http://localhost:3000
```

Development mode:

```bash
npm run start:dev
```

## Health check

```bash
curl http://localhost:3000/health
```

Example response:

```json
{
  "status": "ok",
  "uptime": 30
}
```

## Database check

```bash
curl http://localhost:3000/db-check
```

Expected response:

```json
{
  "status": "ok",
  "database": "database is working"
}
```

The database pool reads the password from `secrets/db_password` when a new database connection is created.

---

# Database password rotation

The database password can be rotated without restarting the application.

The rotation script performs these steps:

1. changes the PostgreSQL role password with `ALTER ROLE`
2. updates `secrets/db_password`
3. terminates old PostgreSQL connections
4. the application pool opens a new connection
5. the password callback reads the new password from the secret file

Run:

```bash
bash rotate.sh
```

The script generates a new password on every run.

## Verify rotation without restart

Start the application and do not restart it during these steps.

Check uptime before rotation:

```bash
curl http://localhost:3000/health
```

Check the database:

```bash
curl http://localhost:3000/db-check
```

Rotate the password:

```bash
bash rotate.sh
```

Check that the secret changed:

```bash
cat secrets/db_password
```

Check the database again:

```bash
curl http://localhost:3000/db-check
```

Expected result:

```json
{
  "status": "ok",
  "database": "database is working"
}
```

Check uptime again:

```bash
curl http://localhost:3000/health
```

The new uptime must be greater than the previous value. This confirms that the application process was not restarted.

## Resetting PostgreSQL

If PostgreSQL is recreated with:

```bash
docker compose down -v
docker compose up -d
```

the database returns to its initial password.

Reset the local secret file as well:

```bash
printf 'marketplace_password' > secrets/db_password
```

Otherwise the application will fail with a PostgreSQL password authentication error.

---

# Docker security checks

Build the image:

```bash
docker build -t myapp .
```

Check image contents:

```bash
docker run --rm myapp ls -a /app
```

`.env.example` should exist.

`.env` and `secrets/` must not exist.

Check `.env` directly:

```bash
docker run --rm myapp sh -c 'cat /app/.env' 2>&1
```

Expected result:

```text
No such file or directory
```

Check image environment:

```bash
docker inspect --format '{{.Config.Env}}' myapp
```

There must be no database passwords or project secrets.

Check image history:

```bash
docker history --no-trunc myapp | grep -i password
```

Expected result: no output.

---

# OpenAPI validation

Validate the API specification:

```bash
npx @redocly/cli lint openapi/openapi.yaml
```

Bundle the specification:

```bash
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
```

Check cursor pagination:

```bash
grep -c 'next_cursor' openapi/openapi.yaml
```

Check problem+json responses:

```bash
grep -c 'application/problem+json' openapi/openapi.yaml
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
