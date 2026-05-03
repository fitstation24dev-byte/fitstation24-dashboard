#!/usr/bin/env bash
# Stop hook: auto commit + push if there are uncommitted changes.
# Silent on success; outputs systemMessage JSON on failure.
set -u
cd "C:/Users/aofwa/Desktop/FITSTATION24" || exit 0

# Nothing to do if working tree is clean
if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  exit 0
fi

out=$( { git add -A && \
         git commit -m "Auto-commit from Claude Code session" && \
         git push; } 2>&1 )
rc=$?

if [ $rc -ne 0 ]; then
  msg=$(printf '%s' "$out" | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-300)
  printf '{"systemMessage": "Auto-push failed: %s"}\n' "$msg"
fi
exit 0
