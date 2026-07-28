#!/bin/sh
set -eu

provider=${1:?provider is required}
verb=${2:?verb is required}
if [ "$#" -ne 2 ]; then
  echo "provider entrypoint rejects trailing arguments" >&2
  exit 64
fi

case "$provider:$verb" in
  codex:login) exec codex login --device-auth ;;
  codex:status) exec codex login status ;;
  codex:interactive) exec codex ;;
  codex:task) exec node /usr/local/lib/rak-provider-task.mjs codex ;;
  claude-code:login) exec claude ;;
  claude-code:status) exec claude auth status ;;
  claude-code:interactive) exec claude ;;
  claude-code:task) exec node /usr/local/lib/rak-provider-task.mjs claude-code ;;
  *)
    echo "provider entrypoint permits only login, status, interactive, or broker-owned task" >&2
    exit 64
    ;;
esac
