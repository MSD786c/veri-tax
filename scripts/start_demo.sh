#!/usr/bin/env bash
# One command for the whole demo: backend + Maskan upload portal (:8000), EmaraTax supplier portal (:3000),
# FTA officer portal (:3001). Opens all three in the browser. Ctrl-C stops everything.
#
#   ./scripts/start_demo.sh            # start (keeps the current local data)
#   ./scripts/start_demo.sh --fresh    # clear the local database and load only the MMB demo case
#
# Expects veri-tax-portals next to veri-tax. Data stays local (veritax.db and data/ are git-ignored).
set -euo pipefail

VT="$(cd "$(dirname "$0")/.." && pwd)"
VP="$(cd "$VT/../veri-tax-portals" && pwd)"
LOGS="$VT/data/logs"
mkdir -p "$LOGS"

free_port() { lsof -ti :"$1" 2>/dev/null | xargs kill 2>/dev/null || true; }
wait_for() { for _ in $(seq 1 90); do curl -s -o /dev/null --max-time 2 "$1" && return 0; sleep 1; done; echo "!! $1 did not come up (see $LOGS)"; return 1; }

echo "Stopping anything on :8000 :3000 :3001"
free_port 8000; free_port 3000; free_port 3001; sleep 1

if [[ "${1:-}" == "--fresh" ]]; then
  echo "Clearing the local database and stored documents"
  rm -f "$VT/veritax.db"; rm -rf "$VT/data/documents"
fi

pids=()
cleanup() { echo; echo "Stopping all servers"; kill "${pids[@]}" 2>/dev/null || true; free_port 8000; free_port 3000; free_port 3001; }
trap cleanup EXIT INT TERM

echo "Backend + Maskan portal on :8000 (local OCR + Gemini, no seed data)"
( cd "$VT" && SEED=0 LOCAL_OCR=1 uv run --env-file .env.demo uvicorn app.main:app --reload --reload-dir app \
    --reload-include "*.html" --port 8000 >"$LOGS/backend.log" 2>&1 ) & pids+=($!)

echo "EmaraTax supplier portal on :3000"
( cd "$VP" && pnpm dev:emaratax >"$LOGS/emaratax.log" 2>&1 ) & pids+=($!)

echo "FTA officer portal on :3001"
( cd "$VT/apps/fta-portal" && npx next dev -p 3001 >"$LOGS/fta.log" 2>&1 ) & pids+=($!)

wait_for http://localhost:8000/health
if [[ "${1:-}" == "--fresh" ]]; then
  ( cd "$VT" && uv run python scripts/load_demo_supplier.py --reset )
fi
wait_for http://localhost:3000/login
wait_for http://localhost:3001/login

TOKEN="$(cat "$VT/data/maskan_portal_token")"
UPLOAD="http://localhost:8000/maskan/portal/$TOKEN"
cat <<EOF

  Maskan upload portal   $UPLOAD
  EmaraTax (supplier)    http://localhost:3000   sign in as Mumtaz Building Materials (100000000000003)
  FTA officer portal     http://localhost:3001   "Use the demo account"
  API docs               http://localhost:8000/docs
  Logs                   $LOGS

  Demo: upload an MMB_2026_00x PDF -> supplier answers in EmaraTax -> officer reviews in the FTA portal.
  Ctrl-C to stop everything.
EOF

open "$UPLOAD" http://localhost:3000 http://localhost:3001 2>/dev/null || true
wait
