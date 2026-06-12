#!/bin/bash
set -euo pipefail

# Only run dependency installation in the remote (Claude Code on the web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install dependencies from the lockfile for a reproducible install.
npm ci
