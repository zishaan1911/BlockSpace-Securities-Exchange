#!/usr/bin/env bash
# Runs the full test suite for both stacks that currently have one:
#   - contracts/gasx     (Sui Move)
#   - engine              (C++)
#
# Usage: ./scripts/test-all.sh
# Requires: sui CLI on PATH, cmake + a C++17 compiler.

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
if [ "$FAILED" -eq 0 ]; then
  echo "ALL SUITES PASSED"
else
  echo "ONE OR MORE SUITES FAILED — see output above"
fi
exit "$FAILED"
