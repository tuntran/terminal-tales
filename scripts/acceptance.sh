#!/usr/bin/env bash
# Acceptance checks for the shared-fight daemon, run on a real machine.
#
# Daemon-only checks run in a throwaway data directory. Session checks start
# headless `claude -p` sessions with this folder as a plugin, so they use the
# install's own data directory under ~/.claude/tt/ (the plugin keeps its id in
# its store); they never delete it, and only stop the daemon they find there.
#
# Usage: bash scripts/acceptance.sh [--sessions]   (sessions make model calls)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$(command -v node || command -v bun)"
WITH_SESSIONS=0
[[ "${1:-}" == "--sessions" ]] && WITH_SESSIONS=1

pass=0
fail=0
ok() { echo "  ok   $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL $1"; fail=$((fail + 1)); }

TMP="$(mktemp -d /tmp/tt-accept.XXXX)"
STARTED=()
cleanup() {
  for pid in "${STARTED[@]:-}"; do [[ -n "$pid" ]] && { kill "$pid"; wait "$pid"; } 2>/dev/null || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT

hello() { curl -s -m 1 --unix-socket "$1/d.sock" http://d/hello 2>/dev/null || true; }
lock_pid() { sed -E 's/.*"pid":([0-9]+).*/\1/' "$1/daemon.lock" 2>/dev/null || true; }

wait_hello() { # dir seconds
  local deadline=$((SECONDS + $2))
  while ((SECONDS < deadline)); do
    [[ -n "$(hello "$1")" ]] && return 0
    sleep 0.1
  done
  return 1
}

wait_gone() { # dir seconds
  local deadline=$((SECONDS + $2))
  while ((SECONDS < deadline)); do
    [[ ! -e "$1/d.sock" && ! -e "$1/daemon.lock" ]] && return 0
    sleep 0.5
  done
  return 1
}

echo "Daemon checks ($RUNTIME)"

# A stale lock naming a live but unrelated pid does not keep a daemon out.
DIR="$TMP/stale"
mkdir -m 700 "$DIR"
sleep 600 &
STRANGER=$!
STARTED+=("$STRANGER")
printf '{"pid":%s,"epoch":"old"}' "$STRANGER" >"$DIR/daemon.lock"
TT_IDLE_MS=3000 "$RUNTIME" "$ROOT/dist/launch.js" --detach "$DIR" >/dev/null
if wait_hello "$DIR" 6; then ok "a stale lock with a live unrelated pid is taken over"; else bad "a stale lock with a live unrelated pid is taken over"; fi
STARTED+=("$(lock_pid "$DIR")")

# Three launches at once leave one daemon.
DIR="$TMP/race"
mkdir -m 700 "$DIR"
launches=()
for _ in 1 2 3; do
  TT_IDLE_MS=3000 "$RUNTIME" "$ROOT/dist/launch.js" --detach "$DIR" >/dev/null &
  launches+=($!)
done
wait "${launches[@]}"
wait_hello "$DIR" 5 || true
sleep 1
serving="$(grep -c '^.* serving ' "$DIR/daemon.log" || true)"
stepped="$(grep -c 'another daemon serves' "$DIR/daemon.log" || true)"
if [[ "$serving" == 1 && "$stepped" == 2 ]]; then ok "three launches at once leave one daemon"; else bad "three launches at once leave one daemon (serving=$serving, stepped aside=$stepped)"; fi
STARTED+=("$(lock_pid "$DIR")")

# A quiet daemon removes its socket and lock and exits.
if wait_gone "$DIR" 8; then ok "an idle daemon exits and removes d.sock and daemon.lock"; else bad "an idle daemon exits and removes d.sock and daemon.lock"; fi

# A world.json from a newer version is never written.
DIR="$TMP/newer"
mkdir -m 700 "$DIR"
printf '{"version":2,"gold":99999}' >"$DIR/world.json"
TT_IDLE_MS=2000 "$RUNTIME" "$ROOT/dist/launch.js" --detach "$DIR" >/dev/null
wait_hello "$DIR" 5 || true
state="$(hello "$DIR" | sed -E 's/.*"state":"([a-z]+)".*/\1/')"
wait_gone "$DIR" 8 || true
if [[ "$state" == locked && "$(cat "$DIR/world.json")" == '{"version":2,"gold":99999}' ]]; then
  ok "a newer world.json locks the daemon and stays as it was"
else
  bad "a newer world.json locks the daemon and stays as it was (state=$state)"
fi

# An unreadable world.json is kept aside.
DIR="$TMP/broken"
mkdir -m 700 "$DIR"
printf '{ broken' >"$DIR/world.json"
TT_IDLE_MS=2000 "$RUNTIME" "$ROOT/dist/launch.js" --detach "$DIR" >/dev/null
wait_hello "$DIR" 5 || true
if ls "$DIR"/world.unreadable-*.json >/dev/null 2>&1 && [[ ! -e "$DIR/world.json" ]]; then
  ok "an unreadable world.json is kept as world.unreadable-<ts>.json"
else
  bad "an unreadable world.json is kept as world.unreadable-<ts>.json"
fi
wait_gone "$DIR" 8 || true

if ((WITH_SESSIONS == 0)); then
  echo "Session checks skipped (pass --sessions to run them)"
  echo "$pass passed, $fail failed"
  ((fail == 0))
  exit
fi

echo "Session checks"

session() { # cwd
  (cd "$1" && claude -p "Reply with just: ok" --plugin-dir "$ROOT" >/dev/null 2>&1)
}

# The data directory these sessions used: the one whose log changed last.
# Other installs (a marketplace copy, say) have their own and are left alone.
data_dir() {
  local newest
  newest="$(ls -t "$HOME"/.claude/tt/*/daemon.log 2>/dev/null | head -1 || true)"
  [[ -n "$newest" ]] && dirname "$newest" || true
}

# Processes holding the data directory's socket: the daemon alone once sessions ended.
holders() { (lsof -t "$1/d.sock" 2>/dev/null || true) | sort -u | wc -l | tr -d ' '; }

PROJECT="$TMP/project"
mkdir -p "$PROJECT"
# A project whose bunfig would run code under bun from its own directory.
cat >"$PROJECT/bunfig.toml" <<'EOF'
preload = ["./preload.ts"]
EOF
echo "require('node:fs').writeFileSync('$TMP/preload-ran', 'yes')" >"$PROJECT/preload.ts"

# Three sessions at once share one daemon.
sessions=()
for _ in 1 2 3; do
  session "$PROJECT" &
  sessions+=($!)
done
wait "${sessions[@]}"
DATA="$(data_dir)"
if [[ -z "$DATA" ]]; then
  bad "the sessions created one data directory under ~/.claude/tt"
else
  count="$(holders "$DATA")"
  if [[ "$count" == 1 ]]; then ok "three sessions at once share one daemon"; else bad "three sessions at once share one daemon (found $count)"; fi
  if [[ ! -e "$TMP/preload-ran" ]]; then ok "a project's bunfig preload never runs"; else bad "a project's bunfig preload never runs"; fi

  # A killed daemon is started again by the next session, and its world is kept.
  before="$(sed -E 's/.*"kills":([0-9]+).*/\1/' "$DATA/world.json")"
  kill -9 "$(lock_pid "$DATA")"
  t0=$SECONDS
  session "$PROJECT" &
  next=$!
  if wait_hello "$DATA" 30; then
    ok "the next session starts a killed daemon again ($((SECONDS - t0))s after the session began, boot included)"
  else
    bad "the next session starts a killed daemon again"
  fi
  wait "$next"
  after="$(sed -E 's/.*"kills":([0-9]+).*/\1/' "$DATA/world.json")"
  if ((after >= before)); then ok "the world survives the kill (kills $before -> $after)"; else bad "the world survives the kill (kills $before -> $after)"; fi

  # With every session closed, the daemon exits within 15 s of quiet.
  last="$(lock_pid "$DATA")"
  if wait_gone "$DATA" 25 && ! kill -0 "$last" 2>/dev/null; then
    ok "with every session closed the daemon exits and cleans up"
  else
    bad "with every session closed the daemon exits and cleans up"
  fi
fi

echo "$pass passed, $fail failed"
((fail == 0))
