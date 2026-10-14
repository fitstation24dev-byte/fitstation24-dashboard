#!/usr/bin/env bash
# Stop hook: auto commit + push if there are uncommitted changes.
# Silent on success; outputs systemMessage JSON on failure.
set -u
cd "C:/Users/aofwa/OneDrive/Desktop/FITSTATION24" || exit 0

dirty=$(git status --porcelain 2>/dev/null)
ahead=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)

# Nothing to do if working tree is clean and every commit is already pushed
if [ -z "$dirty" ] && [ "$ahead" = "0" ]; then
  exit 0
fi

if [ -n "$dirty" ]; then
  out=$( { git add -A && \
           git commit -m "Auto-commit from Claude Code session" && \
           git push; } 2>&1 )
else
  # commit ไว้แล้วแต่ยังไม่ได้ push (เช่น Claude commit เองพร้อมข้อความ)
  out=$(git push 2>&1)
fi
rc=$?

if [ $rc -ne 0 ]; then
  msg=$(printf '%s' "$out" | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-300)
  printf '{"systemMessage": "Auto-push failed: %s"}\n' "$msg"
fi
exit 0
