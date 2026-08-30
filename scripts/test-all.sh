#!/usr/bin/env bash
# Runs the full test suite for every stack that currently has one:
#   - contracts/gasx     (Sui Move)
#   - engine              (C++)
#   - ai                  (Python)
#
# Usage: ./scripts/test-all.sh
# Requires: sui CLI on PATH, cmake + a C++17 compiler, and either an
# ai/venv (see ai/README.md) or pytest importable via `python3 -m pytest`.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

echo "==> contracts/gasx (Sui Move)"
if command -v sui >/dev/null 2>&1; then
  (cd "$REPO_ROOT/contracts/gasx" && sui move test)
  MOVE_STATUS=$?
  if [ "$MOVE_STATUS" -ne 0 ]; then
    echo "!! Move tests FAILED"
    FAILED=1
  else
    echo "-- Move tests passed"
  fi
else
  echo "!! sui CLI not found on PATH — skipping Move tests"
  echo "   (see contracts/gasx/README.md for build/test instructions)"
  FAILED=1
fi

echo
echo "==> engine (C++)"
BUILD_DIR="$REPO_ROOT/engine/build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
if (cd "$BUILD_DIR" && cmake -DCMAKE_BUILD_TYPE=Release .. && make -j"$(nproc 2>/dev/null || echo 4)" && ctest --output-on-failure); then
  echo "-- Engine tests passed"
else
  echo "!! Engine tests FAILED"
  FAILED=1
fi

echo
echo "==> ai (Python)"
if [ -x "$REPO_ROOT/ai/venv/bin/pytest" ]; then
  PYTEST="$REPO_ROOT/ai/venv/bin/pytest"
elif command -v pytest >/dev/null 2>&1; then
  PYTEST="pytest"
elif python3 -c "import pytest" >/dev/null 2>&1; then
  PYTEST="python3 -m pytest"
else
  PYTEST=""
fi
if [ -n "$PYTEST" ]; then
  (cd "$REPO_ROOT/ai" && $PYTEST)
  AI_STATUS=$?
  if [ "$AI_STATUS" -ne 0 ]; then
    echo "!! AI service tests FAILED"
    FAILED=1
  else
    echo "-- AI service tests passed"
  fi
else
  echo "!! pytest not found (no ai/venv, and no system pytest) — skipping AI tests"
  echo "   (see ai/README.md for setup instructions)"
  FAILED=1
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "ALL SUITES PASSED"
else
  echo "ONE OR MORE SUITES FAILED — see output above"
fi
exit "$FAILED"
