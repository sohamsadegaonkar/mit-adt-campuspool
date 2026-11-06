#!/usr/bin/env python3
"""Allowlist-only diagnostics for Azure CLI failures; never print raw stderr.

This utility accepts a private temporary file containing an Azure CLI error.
It prints only recognized generic codes/statuses and troubleshooting category,
not messages, headers, URLs, account identifiers, tokens, or raw response data.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

SAFE_CODES = {
    "AuthorizationFailed": "ACCESS_REVIEW",
    "BillingAccessDenied": "ACCESS_REVIEW",
    "AccountCostDisabled": "ACCESS_REVIEW",
    "DepartmentCostDisabled": "ACCESS_REVIEW",
    "Forbidden": "ACCESS_REVIEW",
    "Unauthorized": "AUTH_REVIEW",
    "AuthenticationFailed": "AUTH_REVIEW",
    "BadRequest": "REQUEST_REVIEW",
    "InvalidRequest": "REQUEST_REVIEW",
    "InvalidQueryDefinition": "REQUEST_REVIEW",
    "InvalidTimeRange": "REQUEST_REVIEW",
    "DontContainsValidTimeRangeWhileContainsPeriod": "REQUEST_REVIEW",
    "SubscriptionTypeNotSupported": "OFFER_SCOPE_REVIEW",
    "DisallowedOperation": "OFFER_SCOPE_REVIEW",
    "ResourceNotFound": "SCOPE_REVIEW",
    "NotFound": "SCOPE_REVIEW",
    "TooManyRequests": "RETRY_LATER",
    "InternalServerError": "AZURE_RETRY_LATER",
    "ServiceUnavailable": "AZURE_RETRY_LATER",
}
STATUS_CATEGORY = {
    "400": "REQUEST_REVIEW",
    "401": "AUTH_REVIEW",
    "403": "ACCESS_REVIEW",
    "404": "SCOPE_REVIEW",
    "408": "RETRY_LATER",
    "429": "RETRY_LATER",
    "500": "AZURE_RETRY_LATER",
    "502": "AZURE_RETRY_LATER",
    "503": "AZURE_RETRY_LATER",
    "504": "AZURE_RETRY_LATER",
}
# Match only explicit HTTP/status labels, not an ID or an arbitrary number in a message.
STATUS_RE = re.compile(
    r"(?i)(?:HTTP(?:/1\.[01]|/2)?\s+|status(?:\s+code)?\s*[:=]\s*|"
    r"response\s+status\s*[:=]\s*)(400|401|403|404|408|429|500|502|503|504)\b"
)


def diagnose(raw: str) -> dict[str, str]:
    text = raw[:131072]
    status_match = STATUS_RE.search(text)
    status = status_match.group(1) if status_match else "UNKNOWN"
    recognized = None
    for code in SAFE_CODES:
        # Never output a code not on the fixed allowlist, including fake user data.
        if re.search(r"(?<![A-Za-z0-9_])" + re.escape(code) + r"(?![A-Za-z0-9_])", text):
            recognized = code
            break
    category = SAFE_CODES.get(recognized, STATUS_CATEGORY.get(status, "UNKNOWN"))
    return {
        "HTTP_STATUS": status,
        "ERROR_CODE": recognized or "UNCLASSIFIED",
        "CATEGORY": category,
        "PRIVATE_AZURE_ERROR": "REDACTED",
        "BUDGET_GATE": "BLOCKED",
    }


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("COST_DIAGNOSTIC_UNAVAILABLE")
        return 2
    try:
        file = Path(argv[0])
        if not file.is_file() or file.stat().st_size > 131072:
            raise ValueError("invalid error file")
        raw = file.read_text(encoding="utf-8", errors="replace")
    except (ValueError, OSError):
        print("COST_DIAGNOSTIC_UNAVAILABLE")
        return 3
    for key, value in diagnose(raw).items():
        print("COST_" + key + "=" + value)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
