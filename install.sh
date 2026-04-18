#!/bin/bash
# Install/update the Trax Replit publisher + receiver launchd jobs.
# Usage: bash install.sh <ingest-token>
#   <ingest-token> is the INGEST_TOKEN secret set in the Replit deployment.
#   The receiver plist doesn't need the token (only the publisher POSTs).
set -e

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
    echo "usage: bash install.sh <ingest-token>" >&2
    exit 1
fi

SRC_DIR="$HOME/Trax/replit-status"
AGENTS="$HOME/Library/LaunchAgents"

mkdir -p "$AGENTS" "$HOME/Trax/session-log"

install_plist() {
    local name="$1"
    local src="$SRC_DIR/$name.plist"
    local dst="$AGENTS/$name.plist"
    if [ ! -f "$src" ]; then
        echo "skip: $src not found"
        return
    fi
    sed "s|REPLACE_ME_WITH_YOUR_TOKEN|$TOKEN|" "$src" > "$dst"
    chmod 600 "$dst"
    launchctl unload "$dst" 2>/dev/null || true
    launchctl load "$dst"
    echo "loaded: $name"
}

install_plist com.trax.replit-publisher
install_plist com.trax.replit-receiver

echo "waiting for first runs..."
sleep 4

for log in replit-publisher-stdout replit-receiver-stdout; do
    path="$HOME/Trax/session-log/$log.log"
    if [ -s "$path" ]; then
        echo "--- $log (tail) ---"
        tail -3 "$path"
    fi
done
