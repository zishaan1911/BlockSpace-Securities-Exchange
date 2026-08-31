#!/usr/bin/env bash
# Runs all test suites, or one selected suite:
#   - contracts/gasx         (Sui Move)
#   - engine                  (C++)
#   - ai                      (Python)
#   - blockchain/thetanuts    (TypeScript)
#   - blockchain/sui          (TypeScript)
#   - api                      (TypeScript)
#   - frontend                 (TypeScript)
#
# Usage:
#   ./scripts/test-all.sh
#   ./scripts/test-all.sh all
#   ./scripts/test-all.sh typescript
#   ./scripts/test-all.sh frontend
#   ./scripts/test-all.sh python
#   ./scripts/test-all.sh cpp
#   ./scripts/test-all.sh move
#
# Requires: sui CLI on PATH, cmake + a C++17 compiler, either an
# ai/venv (see ai/README.md) or pytest importable via `python3 -m
# pytest`, and Node.js >= 18 + npm for the TypeScript stacks.
#
# api/ depends on blockchain/thetanuts and blockchain/sui being built
# first (their dist/ must exist), so the TypeScript suite builds them
# in that order.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELECTED_SUITE="${1:-all}"
FAILED=0

usage() {
  echo "Usage: ./scripts/test-all.sh [all|typescript|frontend|python|cpp|move]"
}

case "$SELECTED_SUITE" in
  all|typescript|frontend|python|cpp|move)
    ;;
  *)
    echo "Unknown test suite: $SELECTED_SUITE"
    usage
    exit 2
    ;;
esac

run_move() {
  echo
  echo "==> contracts/gasx (Sui Move)"

  if command -v sui >/dev/null 2>&1; then
    if (cd "$REPO_ROOT/contracts/gasx" && sui move test); then
      echo "-- Move tests passed"
      return 0
    fi

    echo "!! Move tests FAILED"
    return 1
  fi

  echo "!! sui CLI not found on PATH — skipping Move tests"
  echo "   (see contracts/gasx/README.md for build/test instructions)"
  return 1
}

run_cpp() {
  echo
  echo "==> engine (C++)"

  local build_dir="$REPO_ROOT/engine/build"

  # Preserve the original clean-build behaviour so stale CMake state
  # cannot affect local or CI test results.
  rm -rf "$build_dir"
  mkdir -p "$build_dir"

  if (
    cd "$build_dir" &&
    cmake -DCMAKE_BUILD_TYPE=Release .. &&
    make -j"$(nproc 2>/dev/null || echo 4)" &&
    ctest --output-on-failure
  ); then
    echo "-- Engine tests passed"
    return 0
  fi

  echo "!! Engine tests FAILED"
  return 1
}

run_python() {
  echo
  echo "==> ai (Python)"

  local pytest_command

  # Preserve the original interpreter and pytest resolution order.
  if [ -x "$REPO_ROOT/ai/venv/bin/pytest" ]; then
    pytest_command="$REPO_ROOT/ai/venv/bin/pytest"
  elif command -v pytest >/dev/null 2>&1; then
    pytest_command="pytest"
  elif python3 -c "import pytest" >/dev/null 2>&1; then
    pytest_command="python3 -m pytest"
  else
    pytest_command=""
  fi

  if [ -z "$pytest_command" ]; then
    echo "!! pytest not found (no ai/venv, and no system pytest) — skipping AI tests"
    echo "   (see ai/README.md for setup instructions)"
    return 1
  fi

  # Disable globally registered third-party pytest plugins. Project
  # conftest.py files and tests are still discovered normally.
  if (
    cd "$REPO_ROOT/ai" &&
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 $pytest_command
  ); then
    echo "-- AI service tests passed"
    return 0
  fi

  echo "!! AI service tests FAILED"
  return 1
}

install_node_dependencies() {
  local project_dir="$1"

  if [ "${CI:-}" = "true" ]; then
    (
      cd "$project_dir" &&
      npm ci
    )
  elif [ ! -d "$project_dir/node_modules" ]; then
    echo "-- node_modules missing, running npm install first"
    (
      cd "$project_dir" &&
      npm install
    )
  fi
}

run_ts_project() {
  local project_path="$1"
  local project_name="$2"
  local should_build="$3"
  local project_dir="$REPO_ROOT/$project_path"

  echo
  echo "==> $project_path (TypeScript)"

  if ! install_node_dependencies "$project_dir"; then
    echo "!! $project_name dependency installation FAILED"
    return 1
  fi

  if [ "$should_build" = "true" ]; then
    if (
      cd "$project_dir" &&
      npm run typecheck &&
      npm run build &&
      npm test
    ); then
      echo "-- $project_name tests passed"
      return 0
    fi
  else
    if (
      cd "$project_dir" &&
      npm run typecheck &&
      npm test
    ); then
      echo "-- $project_name tests passed"
      return 0
    fi
  fi

  echo "!! $project_name tests FAILED"
  return 1
}

run_typescript() {
  local typescript_failed=0

  if ! command -v npm >/dev/null 2>&1; then
    echo "!! npm not found on PATH — skipping TypeScript tests"
    echo "   Node.js >= 18 and npm are required."
    return 1
  fi

  # Build both adapters first because the API imports their dist output.
  if ! run_ts_project \
    "blockchain/thetanuts" \
    "Thetanuts adapter" \
    "true"; then
    typescript_failed=1
  fi

  if ! run_ts_project \
    "blockchain/sui" \
    "Sui adapter" \
    "true"; then
    typescript_failed=1
  fi

  if ! run_ts_project \
    "api" \
    "API gateway" \
    "false"; then
    typescript_failed=1
  fi

  return "$typescript_failed"
}

run_frontend() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "!! npm not found on PATH — skipping frontend tests"
    echo "   Node.js >= 18 and npm are required."
    return 1
  fi

  if [ ! -f "$REPO_ROOT/frontend/package.json" ]; then
    echo "!! frontend/package.json not found"
    return 1
  fi

  run_ts_project \
    "frontend" \
    "Frontend" \
    "false"
}

run_and_record() {
  if ! "$@"; then
    FAILED=1
  fi
}

case "$SELECTED_SUITE" in
  all)
    run_and_record run_move
    run_and_record run_cpp
    run_and_record run_python
    run_and_record run_typescript
    run_and_record run_frontend
    ;;
  move)
    run_and_record run_move
    ;;
  cpp)
    run_and_record run_cpp
    ;;
  python)
    run_and_record run_python
    ;;
  typescript)
    run_and_record run_typescript
    ;;
  frontend)
    run_and_record run_frontend
    ;;
esac

echo

if [ "$FAILED" -eq 0 ]; then
  echo "ALL REQUESTED SUITES PASSED"
else
  echo "ONE OR MORE REQUESTED SUITES FAILED — see output above"
fi

exit "$FAILED"
