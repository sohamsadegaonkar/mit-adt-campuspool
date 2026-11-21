#!/usr/bin/env bash
# OWNER-ONLY Azure Cloud Shell. READ ONLY. No auth token, ID, invoice or URL logs.
# Queries only existing Azure for Students costs and forecast; no resources changed.
set -euo pipefail
umask 077

RG="campuspool-backup-rg"
EXPECTED_SUBSCRIPTION_NAME="Azure for Students"
API_VERSION="2025-03-01"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PARSER="${HERE}/../../scripts/azure_31day_cost_evidence.py"
ERROR_SANITIZER="${HERE}/../../scripts/azure_cost_error_sanitize.py"

[[ -f "$PARSER" && -f "$ERROR_SANITIZER" ]] || { echo "STOP: cost review utilities unavailable" >&2; exit 2; }
command -v az >/dev/null && command -v python3 >/dev/null || {
  echo "STOP: Azure CLI and Python 3 required" >&2
  exit 2
}

account_name="$(az account show --query name -o tsv 2>/dev/null)" || {
  echo "COST_ACCESS_BLOCKED: sign in to Azure for Students" >&2; exit 3
}
[[ "$account_name" == "$EXPECTED_SUBSCRIPTION_NAME" ]] || {
  echo "STOP: selected subscription is not Azure for Students" >&2; exit 3
}
subscription_id="$(az account show --query id -o tsv 2>/dev/null)" || {
  echo "COST_SCOPE_BLOCKED" >&2; exit 3
}
[[ "$subscription_id" =~ ^[0-9a-fA-F-]{36}$ ]] || {
  echo "COST_SCOPE_INVALID" >&2; exit 3
}
selected_group="$(az group show --name "$RG" --query name -o tsv 2>/dev/null)" || {
  echo "COST_RG_NOT_ACCESSIBLE" >&2; exit 3
}
[[ "$selected_group" == "$RG" ]] || { echo "COST_RG_MISMATCH" >&2; exit 3; }

private_dir="$(mktemp -d)"
chmod 700 "$private_dir"
trap 'rm -rf -- "$private_dir"' EXIT

# Both requests are evaluated using the SAME UTC date snapshot.
utc_today="$(date -u +%Y-%m-%d)"
request_body() {
  python3 - "$1" "$utc_today" <<'PY'
import datetime as dt,json,sys
kind,raw_today=sys.argv[1:3]
today=dt.date.fromisoformat(raw_today)
if kind=="historical":
    start=today-dt.timedelta(days=30)
    end=today
else:
    start=today+dt.timedelta(days=1)
    end=today+dt.timedelta(days=31)
stamp=lambda day,time: day.isoformat()+"T"+time+"+00:00"
body={
  "type":"Usage",
  "timeframe":"Custom",
  "timePeriod":{"from":stamp(start,"00:00:00"),"to":stamp(end,"23:59:59")},
  "dataset":{
    "granularity":"Daily",
    "aggregation":{"totalCost":{"name":"PreTaxCost","function":"Sum"}},
    "grouping":[{"type":"Dimension","name":"ServiceName"}]
  }
}
if kind=="forecast":
    body["includeActualCost"]=False
    body["includeFreshPartialCost"]=False
print(json.dumps(body,separators=(",",":")))
PY
}

actual_url="https://management.azure.com/subscriptions/${subscription_id}/resourceGroups/${RG}/providers/Microsoft.CostManagement/query?api-version=${API_VERSION}"
forecast_url="https://management.azure.com/subscriptions/${subscription_id}/resourceGroups/${RG}/providers/Microsoft.CostManagement/forecast?api-version=${API_VERSION}"
actual_body="$(request_body historical)"
forecast_body="$(request_body forecast)"

echo "CAMPUSPOOL_AZURE_FOR_STUDENTS_BILLING_SCOPE=CONFIRMED"
echo "SCOPE=CAMPUSPOOL_BACKUP_RESOURCE_GROUP_ONLY"
echo "WINDOW_ACTUAL=TRAILING_31_UTC_DAYS_INCLUDING_TODAY"
echo "WINDOW_FORECAST=NEXT_31_FULL_UTC_DAYS"
echo "NO_AZURE_WRITES_OR_RESOURCE_CREATION"

if ! az rest --method post --url "$actual_url" --headers Content-Type=application/json \
  --body "$actual_body" --output json >"$private_dir/actual.json" 2>"$private_dir/actual-error.txt"; then
  echo "COST_ACCESS_BLOCKED: historical Cost Management query unavailable" >&2
  python3 "$ERROR_SANITIZER" "$private_dir/actual-error.txt" || true
  exit 4
fi
if [[ ! -s "$private_dir/actual.json" ]]; then
  echo "COST_ACCESS_BLOCKED: historical response empty (possibly HTTP 204; NOT proof of zero cost)" >&2
  exit 4
fi
if ! az rest --method post --url "$forecast_url" --headers Content-Type=application/json \
  --body "$forecast_body" --output json >"$private_dir/forecast.json" 2>"$private_dir/forecast-error.txt"; then
  echo "COST_ACCESS_BLOCKED: 31-day forecast unavailable" >&2
  python3 "$ERROR_SANITIZER" "$private_dir/forecast-error.txt" || true
  exit 4
fi
if [[ ! -s "$private_dir/forecast.json" ]]; then
  echo "COST_ACCESS_BLOCKED: forecast response empty (NOT proof of zero cost)" >&2
  exit 4
fi

python3 "$PARSER" "$private_dir/actual.json" "$private_dir/forecast.json"
echo "NO_BUDGET_GO: must still add planned resources, tax/FX, contingency and owner-approved private quote"
