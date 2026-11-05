#!/usr/bin/env python3
"""Read-only Azure Cost Management evidence parser. Never certifies spend or starts resources.

Inputs are private Azure Cost Management Usage and Forecast JSON files. The
program prints only grouped service totals: never subscription IDs, resource
names, invoice metadata, bearer tokens or original API bodies.
"""
from __future__ import annotations
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

MAX_FILE_BYTES = 1024 * 1024
MAX_ROWS = 5000
MAX_SERVICES = 200
SERVICE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 &.,()_+/-]{0,79}$")
CENT = Decimal("0.01")


class EvidenceBlocked(ValueError):
    pass


def read_private_json(filename: str) -> dict:
    path = Path(filename)
    if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
        raise EvidenceBlocked("COST_INPUT_UNAVAILABLE_OR_TOO_LARGE")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, ValueError, OSError):
        raise EvidenceBlocked("COST_INPUT_INVALID")
    if not isinstance(data, dict):
        raise EvidenceBlocked("COST_JSON_OBJECT_REQUIRED")
    return data


def parse_pretax_services(data: dict, *, forecast: bool) -> dict:
    props = data.get("properties")
    if not isinstance(props, dict) or props.get("nextLink") not in (None, ""):
        raise EvidenceBlocked("COST_DATA_MISSING_OR_PAGINATED")
    columns = props.get("columns")
    rows = props.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list) or not 0 < len(rows) <= MAX_ROWS:
        raise EvidenceBlocked("COST_ROWS_EMPTY_OR_TOO_LARGE")
    names = [c.get("name") if isinstance(c, dict) else None for c in columns]
    if any(not isinstance(name, str) for name in names) or len(set(names)) != len(names):
        raise EvidenceBlocked("COST_COLUMN_SCHEMA_INVALID")
    if any(name not in names for name in ("PreTaxCost", "Currency", "ServiceName")):
        raise EvidenceBlocked("COST_COLUMNS_INCOMPLETE")
    idx_cost, idx_ccy, idx_name = [names.index(k) for k in ("PreTaxCost", "Currency", "ServiceName")]
    idx_status = names.index("CostStatus") if "CostStatus" in names else None
    totals: dict[str, Decimal] = {}
    for row in rows:
        if not isinstance(row, list) or len(row) != len(names):
            raise EvidenceBlocked("COST_ROW_INVALID")
        if row[idx_ccy] != "INR":
            raise EvidenceBlocked("COST_CURRENCY_NOT_INR")
        if forecast and idx_status is not None and row[idx_status] != "Forecast":
            raise EvidenceBlocked("FORECAST_NOT_FORECAST_STATUS")
        name = row[idx_name]
        if not isinstance(name, str) or not SERVICE_RE.fullmatch(name):
            raise EvidenceBlocked("COST_SERVICE_LABEL_UNEXPECTED")
        try:
            value = Decimal(str(row[idx_cost]))
        except (TypeError, InvalidOperation, ValueError):
            raise EvidenceBlocked("COST_VALUE_INVALID")
        if not value.is_finite() or value < 0 or value > Decimal("100000000"):
            raise EvidenceBlocked("COST_VALUE_OUT_OF_RANGE")
        totals[name] = totals.get(name, Decimal("0")) + value
        if len(totals) > MAX_SERVICES:
            raise EvidenceBlocked("COST_SERVICE_COUNT_TOO_LARGE")
    return {
        "currency": "INR",
        "pretax_total_inr": str(sum(totals.values(), Decimal("0")).quantize(CENT)),
        "by_service": {name: str(amount.quantize(CENT)) for name, amount in sorted(totals.items())},
    }


def review(actual: dict, forecast: dict) -> dict:
    a = parse_pretax_services(actual, forecast=False)
    f = parse_pretax_services(forecast, forecast=True)
    return {
        "status": "PRETAX_AZURE_ACCOUNT_EVIDENCE_ONLY",
        "actual_trailing_31_days": a,
        "forecast_next_31_days": f,
        "budget_cap_inr": 500,
        "budget_pass": False,
        "provisioning_authorized": False,
        "staging_export_authorized": False,
        "independent_restore_verified": False,
        "reason": (
            "Cost APIs show historical and baseline forecast pre-tax charges only; "
            "new resources, tax/FX, regional transfers, other RG charges, "
            "15%/INR50 contingency and human quote review remain separate."
        ),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("COST_EVIDENCE_BLOCKED: EXPECT_TWO_PRIVATE_JSON_FILES", file=sys.stderr)
        return 2
    try:
        result = review(read_private_json(argv[0]), read_private_json(argv[1]))
    except (EvidenceBlocked, OSError):
        print("COST_EVIDENCE_BLOCKED: AUTHENTICATED_DATA_INCOMPLETE", file=sys.stderr)
        return 3
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
