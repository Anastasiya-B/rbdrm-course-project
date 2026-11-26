#!/usr/bin/env bash
set -euo pipefail

output="${1:-.env.compose.local}"
if [[ -e "$output" ]]; then
  echo "Refusing to overwrite $output" >&2
  exit 1
fi
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
openssl genrsa 2048 > "$tmpdir/private.pem" 2>/dev/null
openssl rsa -in "$tmpdir/private.pem" -pubout -out "$tmpdir/public.pem" 2>/dev/null
private_key="$(base64 < "$tmpdir/private.pem" | tr -d '\n')"
public_key="$(base64 < "$tmpdir/public.pem" | tr -d '\n')"
{
  printf 'JWT_KID=local-compose\n'
  printf 'JWT_PRIVATE_KEY=%s\n' "$private_key"
  printf 'JWT_PUBLIC_KEY=%s\n' "$public_key"
  printf 'REFRESH_TOKEN_PEPPER=%s\n' "$(openssl rand -hex 32)"
} > "$output"
chmod 600 "$output"
echo "Created local Compose secrets at $output (values were not displayed)."
