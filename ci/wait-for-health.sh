#!/usr/bin/env bash
# Block until the compose stack answers /api/health, or fail loudly.
#
# Usage: wait-for-health.sh [timeout-seconds]
#
# The generous default matters: a boot that has to reconcile the Next build
# against newly installed modules runs a full `next build` before it binds a
# port, and that is minutes, not seconds. A short timeout here would report a
# healthy behaviour as a failure.
set -euo pipefail

timeout="${1:-180}"
# The port is the caller's: this box runs nine other projects and a
# development server already holds 3001, so a pipeline here publishes the
# stack somewhere else and says where.
url="${HEALTH_URL:-http://127.0.0.1:${APP_PORT:-3001}/api/health}"
deadline=$(( SECONDS + timeout ))

while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
        echo "healthy after ${SECONDS}s"
        exit 0
    fi
    sleep 3
done

echo "not healthy within ${timeout}s"
echo "--- compose ps ---"
docker compose ps || true
echo "--- app logs (last 200) ---"
docker compose logs --tail=200 app || true
echo "--- health response ---"
curl -sS -i --max-time 5 "$url" || true
exit 1
