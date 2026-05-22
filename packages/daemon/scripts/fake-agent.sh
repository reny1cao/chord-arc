#!/usr/bin/env bash
#
# fake-agent.sh — stand-in for `claude` / `codex` / `gemini` during smoke tests.
#
# Reads the milestone brief from one of:
#   1. `-p <text>` (the way agent-runner invokes the "claude" branch)
#   2. a positional file path (the default branch when agent-runner doesn't
#      recognize the CLI by name — fall-through for any unknown binary)
#
# Writes `out/result.txt` echoing the brief + a timestamp, then exits 0.
# agent-runner will pick up `out/` as the deliverable target and hash it.

set -euo pipefail

brief=""

if [[ "${1:-}" == "-p" && -n "${2:-}" ]]; then
  brief="$2"
elif [[ -n "${1:-}" && -f "$1" ]]; then
  brief="$(cat "$1")"
else
  # Last-resort: emit something so the test still sees a deliverable.
  brief="(no brief — fake-agent invoked with args: $*)"
fi

# agent-runner gives us its sandbox cwd; CHORD_MILESTONE_CWD is also exported
# but cwd is already that directory, so out/ is relative to here.
mkdir -p out
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > out/result.txt <<EOF
fake-agent.sh deliverable
=========================
generated_at: ${ts}
cwd: $(pwd)

---- brief ----
${brief}
---- end brief ----
EOF

# Mimic the kind of progress-line output a real agent CLI streams so the SSE
# log has something interesting to show.
echo "[fake-agent] received brief (${#brief} chars)"
echo "[fake-agent] wrote out/result.txt"
echo "[fake-agent] done at ${ts}"

exit 0
