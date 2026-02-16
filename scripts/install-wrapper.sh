#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="${1:-$HOME/.local/bin}"

codex-mirror wrapper install --bin-dir "$BIN_DIR"

echo "Wrappers installed in $BIN_DIR"
