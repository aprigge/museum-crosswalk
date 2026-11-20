#!/bin/sh
# Store the Anthropic API key from .env as the Ask Worker's secret on Cloudflare.
# The key goes straight from .env to Wrangler and is never printed.
set -e
cd "$(dirname "$0")/.."
PATH="$HOME/.nvm/versions/node/v26.5.0/bin:$PATH"
key=$(grep '^ANTHROPIC_API_KEY=' .env | cut -d= -f2-)
if [ -z "$key" ]; then
  echo "No ANTHROPIC_API_KEY line in .env" >&2
  exit 1
fi
printf '%s' "$key" | npx wrangler secret put ANTHROPIC_API_KEY --config worker/wrangler.jsonc
