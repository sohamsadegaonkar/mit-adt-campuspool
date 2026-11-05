#!/usr/bin/env bash
# Owner Cloud Shell ONLY. Azure Cost Management QUERY is a read-only POST.
# No Azure writes, raw invoices, secrets, resource IDs or account IDs printed.
set -euo pipefail
echo "CAMPUSPOOL_COST_READONLY_MODE=YES"
subscription_name="$(az account show --query name -o tsv 2>/dev/null)" || {
  echo "STOP: Azure subscription unavailable" >&2
  exit 2
}
if [[ "$subscription_name" != "Azure for Students" ]]; then
  echo "STOP: unexpected selected subscription" >&2
  exit 2
fi
subscription_id="$(az account show --query id -o tsv 2>/dev/null)"
[[ -n "$subscription_id" ]] || { echo "STOP: missing subscription scope" >&2; exit 2; }
rg="campuspool-backup-rg"
az group show --name "$rg" --query name -o tsv >/dev/null || {
  echo "STOP: CampusPool resource group unavailable" >&2
  exit 2
}
url="https://management.azure.com/subscriptions/$subscription_id/resourceGroups/$rg/providers/Microsoft.CostManagement/query?api-version=2023-03-01"
body='{"type":"Usage","timeframe":"MonthToDate","dataset":{"granularity":"None","aggregation":{"totalCost":{"name":"PreTaxCost","function":"Sum"}},"grouping":[{"type":"Dimension","name":"ServiceName"}]}}'
tmp="$(mktemp)"
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT
if ! az rest --method post --url "$url" --headers Content-Type=application/json \
  --body "$body" --output json > "$tmp" 2>/dev/null; then
  echo "COST_ACCESS_BLOCKED: account may lack Cost Management query permission" >&2
  exit 3
fi
python3 - "$tmp" <<'PY'
import json,sys
try:
    with open(sys.argv[1],encoding="utf-8") as f: data=json.load(f)
    props=data.get("properties",{})
    if props.get("nextLink"): raise ValueError("pagination")
    cols=[x.get("name") for x in props.get("columns",[])]
    rows=props.get("rows",[])
    if not rows: raise ValueError("missing_cost_rows")
    amount_i=cols.index("PreTaxCost")
    currency_i=cols.index("Currency")
    service_i=cols.index("ServiceName")
    totals={}; currencies=set()
    for row in rows:
        cost=row[amount_i]
        if not isinstance(cost,(int,float)) or cost<0:
            raise ValueError("invalid_cost")
        name=str(row[service_i])
        if not name or len(name)>80: raise ValueError("invalid_name")
        totals[name]=totals.get(name,0)+float(cost)
        currencies.add(str(row[currency_i]))
    if len(currencies)!=1: raise ValueError("mixed_currency")
    currency=next(iter(currencies))
    print("CAMPUSPOOL_RESOURCE_GROUP_MONTH_TO_DATE_PRETAX")
    for name,value in sorted(totals.items()):
        print("{}: {:.4f} {}".format(name,value,currency))
    print("TOTAL_PRETAX: {:.4f} {}".format(sum(totals.values()),currency))
    print("ACTUAL_USAGE_ONLY_NOT_31_DAY_FORECAST_OR_TAX_INCLUSIVE_CAP")
    print("NO_BILLING_IDENTIFIERS_OR_RESOURCE_IDS_PRINTED")
except Exception:
    print("COST_REPORT_INCOMPLETE_OR_UNVERIFIED",file=sys.stderr)
    sys.exit(4)
PY
