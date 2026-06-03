#!/bin/bash
# FloodNav B200 — Start inference server + Cloudflare Tunnel
# Usage:
#   ./tunnel.sh                  # auto-generate API key
#   ./tunnel.sh mySecretKey      # use provided key
#   ./tunnel.sh --no-key         # skip API key (open access)

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[tunnel]${NC} $*"; }
ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*"; }

PORT=8087

# ── API Key ───────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--no-key" ]]; then
    export B200_API_KEY=""
    warn "Running WITHOUT API key — all endpoints are public"
elif [[ -n "${1:-}" ]]; then
    export B200_API_KEY="$1"
    ok "Using provided API key"
elif [[ -n "${B200_API_KEY:-}" ]]; then
    ok "Using B200_API_KEY from environment"
else
    export B200_API_KEY="floodnav-$(openssl rand -hex 8)"
    ok "Generated API key: ${GREEN}${B200_API_KEY}${NC}"
fi

# ── Install cloudflared ───────────────────────────────────────────────────────
if ! command -v cloudflared &>/dev/null; then
    info "Installing cloudflared..."
    ARCH=$(uname -m)
    if [[ "$ARCH" == "x86_64" ]]; then
        CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    elif [[ "$ARCH" == "aarch64" ]]; then
        CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    else
        err "Unknown arch $ARCH — download cloudflared manually from https://github.com/cloudflare/cloudflared/releases"
        exit 1
    fi
    curl -fsSL -o /usr/local/bin/cloudflared "$CF_URL"
    chmod +x /usr/local/bin/cloudflared
    ok "cloudflared installed"
else
    ok "cloudflared already installed ($(cloudflared --version 2>&1 | head -1))"
fi

# ── Cleanup on exit ───────────────────────────────────────────────────────────
UVICORN_PID=""
TUNNEL_PID=""

cleanup() {
    echo ""
    info "Shutting down..."
    [[ -n "$UVICORN_PID" ]] && kill "$UVICORN_PID" 2>/dev/null && ok "uvicorn stopped"
    [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null && ok "tunnel stopped"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Kill any existing process on PORT ────────────────────────────────────────
pkill -f "uvicorn main:app" 2>/dev/null || true
fuser -k "${PORT}/tcp"       2>/dev/null || true
# fallback: ss-based kill
SS_PID=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
[[ -n "$SS_PID" ]] && kill -9 "$SS_PID" 2>/dev/null || true
sleep 1

# ── Start uvicorn ─────────────────────────────────────────────────────────────
info "Starting FastAPI inference server on port ${PORT}..."
B200_API_KEY="$B200_API_KEY" uvicorn main:app \
    --host 0.0.0.0 \
    --port "$PORT" \
    --loop uvloop \
    --log-level info &
UVICORN_PID=$!

# Wait until uvicorn is ready
for i in $(seq 1 20); do
    if curl -sf "http://localhost:${PORT}/health" &>/dev/null; then
        ok "FastAPI ready at http://localhost:${PORT}"
        break
    fi
    if ! kill -0 "$UVICORN_PID" 2>/dev/null; then
        err "uvicorn exited unexpectedly"
        exit 1
    fi
    sleep 1
done

# ── Start Cloudflare Tunnel ───────────────────────────────────────────────────
TUNNEL_LOG=$(mktemp /tmp/cf_tunnel_XXXX.log)
info "Starting Cloudflare Tunnel (quick tunnel — no account needed)..."
# --loglevel info ensures the public URL banner is captured (warn suppresses it)
cloudflared tunnel --url "http://localhost:${PORT}" \
    --no-autoupdate \
    --loglevel info \
    > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# Extract public URL — handles plain-text and JSON log formats
# Polls for up to 20s
PUBLIC_URL=""
for i in $(seq 1 40); do
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
        err "cloudflared exited — logs:"
        cat "$TUNNEL_LOG"
        exit 1
    fi
    # plain text format: https://xxx.trycloudflare.com
    PUBLIC_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
    # JSON format: "url":"https://xxx.trycloudflare.com"
    if [[ -z "$PUBLIC_URL" ]]; then
        PUBLIC_URL=$(grep -oE '"url":"https://[^"]+trycloudflare[^"]*"' "$TUNNEL_LOG" 2>/dev/null | grep -oE 'https://[^"]+' | head -1 || true)
    fi
    if [[ -n "$PUBLIC_URL" ]]; then break; fi
    sleep 0.5
done

if [[ -z "$PUBLIC_URL" ]]; then
    warn "Could not parse tunnel URL — raw log:"
    cat "$TUNNEL_LOG"
    PUBLIC_URL="(see log above)"
fi

# ── Print summary ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  FloodNav B200 — ONLINE${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "  Public URL  : ${CYAN}${PUBLIC_URL}${NC}"
echo -e "  Local URL   : http://localhost:${PORT}"
if [[ -n "$B200_API_KEY" ]]; then
echo -e "  API Key     : ${YELLOW}${B200_API_KEY}${NC}"
echo ""
echo -e "  Add to your ${CYAN}.env${NC} on the frontend server:"
echo -e "    ${GREEN}ML_INFERENCE_URL=${PUBLIC_URL}${NC}"
echo -e "    ${GREEN}B200_API_KEY=${B200_API_KEY}${NC}"
fi
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
info "Press Ctrl+C to stop both services"

# ── Watchdog: restart uvicorn or cloudflared if either crashes ────────────────
while true; do
    if ! kill -0 "$UVICORN_PID" 2>/dev/null; then
        warn "uvicorn crashed — restarting in 3s..."
        sleep 3
        B200_API_KEY="$B200_API_KEY" uvicorn main:app \
            --host 0.0.0.0 \
            --port "$PORT" \
            --loop uvloop \
            --log-level info &
        UVICORN_PID=$!
        ok "uvicorn restarted (PID $UVICORN_PID)"
    fi

    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
        warn "cloudflared crashed — restarting in 3s..."
        sleep 3
        cloudflared tunnel --url "http://localhost:${PORT}" \
            --no-autoupdate \
            --loglevel info \
            >> "$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!
        ok "cloudflared restarted (PID $TUNNEL_PID) — check $TUNNEL_LOG for new URL"
    fi

    sleep 5
done
