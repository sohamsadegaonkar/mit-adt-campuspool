#!/usr/bin/env bash
# Compatibility entrypoint: Azure ARM REST operator-role audit, read-only.
# Retires Azure CLI role-assignment-list option unsupported by current CLI.
set +x
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
exec python3 "$root/scripts/azure-vault-operator-arm-readonly.py" "$@"
