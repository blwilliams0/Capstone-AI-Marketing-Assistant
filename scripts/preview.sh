#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "Install Node.js 24 or newer before running the preview." >&2
  exit 1
fi
if [[ ! -x node_modules/.bin/vite ]]; then
  npm ci
fi

pg_bin="${POCKET_PREVIEW_PG_BIN:-$(command -v pg_config >/dev/null && pg_config --bindir || true)}"
if [[ ! -x "$pg_bin/initdb" || ! -x "$pg_bin/pg_ctl" ]]; then
  echo "Install PostgreSQL and add its bin directory to PATH or set POCKET_PREVIEW_PG_BIN." >&2
  exit 1
fi

# A dedicated cluster and fixed loopback ports keep the preview separate from team services.
preview_dir="$PWD/.tmp/preview"
pg_data="$preview_dir/postgres"
pg_port=55437
api_port=5300
web_port=5173
umask 077
mkdir -p "$preview_dir"
if [[ ! -f "$pg_data/PG_VERSION" ]]; then
  echo "Initializing the local practice database…"
  "$pg_bin/initdb" -D "$pg_data" -U pocket_preview --auth=trust >/dev/null
fi

api_pid=''
web_pid=''
started_pg=''
cleanup() {
  if [[ -n "$web_pid" ]]; then kill "$web_pid" 2>/dev/null || true; fi
  if [[ -n "$api_pid" ]]; then kill "$api_pid" 2>/dev/null || true; fi
  if [[ -n "$started_pg" ]]; then "$pg_bin/pg_ctl" -D "$pg_data" stop -m fast >/dev/null; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Starting local PostgreSQL…"
"$pg_bin/pg_ctl" -D "$pg_data" -l "$preview_dir/postgres.log" \
  -o "-h 127.0.0.1 -p $pg_port -k ''" -w start >/dev/null
started_pg=yes

export DATABASE_URL="postgresql://pocket_preview@127.0.0.1:$pg_port/postgres"
export NODE_ENV=development AUTH_MODE=mock ANTHROPIC_API_KEY='' SUPABASE_PUBLISHABLE_KEY=''
export API_PORT="$api_port" WEB_ORIGIN="http://127.0.0.1:$web_port" VITE_API_URL=''
export POCKET_PREVIEW_MEDIA_DIR="$preview_dir/media"
export POCKET_PREVIEW_PROXY="http://127.0.0.1:$api_port"
unset SUPABASE_URL SUPABASE_SECRET_KEY

echo "Building the API and its dependencies (unchanged artifacts are cached)…"
npm run build -- --filter=@the-pocket/api --concurrency=2
echo "Applying practice database migrations…"
node scripts/preview-db.mjs
node apps/api/dist/index.js &
api_pid=$!
wait_for_http() {
  local url="$1" process="$2" name="$3"
  for ((attempt = 0; attempt < 60; attempt++)); do
    if ! kill -0 "$process" 2>/dev/null; then
      echo "$name exited during startup. Check the terminal output above." >&2
      return 1
    fi
    if curl --fail --silent --max-time 1 "$url" >/dev/null; then return 0; fi
    sleep 1
  done
  echo "$name did not become ready at $url. Check for another process on that port." >&2
  return 1
}
echo "Waiting for the API…"
wait_for_http "http://127.0.0.1:$api_port/health" "$api_pid" "API"
node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts --host 127.0.0.1 --port "$web_port" --strictPort &
web_pid=$!
wait_for_http "http://127.0.0.1:$web_port/health" "$web_pid" "Web preview"
echo "Open http://127.0.0.1:$web_port and choose a practice role. Press Control-C to stop."
# Bash 3 on macOS has no wait -n. Stop both services if either exits.
while kill -0 "$web_pid" 2>/dev/null && kill -0 "$api_pid" 2>/dev/null; do
  sleep 1
done
echo "A preview service stopped. See its terminal output above." >&2
exit 1
