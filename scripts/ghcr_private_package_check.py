#!/usr/bin/env python3
"""GitHub Container Package visibility gate; never echo auth, account IDs or raw API data.

Usage (owner WSL only):
  printf '%s\n' "$PRIVATE_TOKEN_VARIABLE" | python3 scripts/ghcr_private_package_check.py before|after

"before": allow only 404 (first publication) or an existing PRIVATE package.
"after": demand an authenticated PRIVATE personal package; 404/403/etc block.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

EXPECTED_PACKAGE = "campuspool-backup-worker"
EXPECTED_OWNER = "sohamsadegaonkar"
API_URL = "https://api.github.com/user/packages/container/" + EXPECTED_PACKAGE
MAX_RESPONSE = 32768


def visibility_gate(mode: str, *, token: str, opener=urllib.request.urlopen) -> tuple[bool, str]:
    if mode not in ("before", "after") or not token or len(token) > 4096:
        return False, "GHCR_PRIVACY_CHECK_INPUT_INVALID"
    # Never include token in CLI arguments or output, and never print exception bodies.
    request = urllib.request.Request(
        API_URL,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "campuspool-privacy-gate",
        },
        method="GET",
    )
    try:
        with opener(request, timeout=15) as response:
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            return False, "GHCR_PRIVACY_RESPONSE_TOO_LARGE"
        data = json.loads(raw)
    except urllib.error.HTTPError as exc:
        # A true 404 is normal only *before* the initial image publication.
        if exc.code == 404 and mode == "before":
            return True, "GHCR_PACKAGE_NOT_FOUND_FIRST_PUSH_WILL_DEFAULT_PRIVATE"
        return False, "GHCR_PRIVACY_API_HTTP_BLOCKED"
    except (urllib.error.URLError, OSError, ValueError, TypeError):
        return False, "GHCR_PRIVACY_API_UNAVAILABLE"

    if not isinstance(data, dict) or data.get("name") != EXPECTED_PACKAGE or data.get("package_type") != "container":
        return False, "GHCR_PACKAGE_IDENTITY_MISMATCH"
    owner = data.get("owner")
    if not isinstance(owner, dict) or owner.get("login", "").lower() != EXPECTED_OWNER:
        return False, "GHCR_PACKAGE_OWNER_MISMATCH"
    if data.get("visibility") != "private":
        return False, "GHCR_PACKAGE_NOT_PRIVATE"
    return True, "GHCR_PERSONAL_CONTAINER_PACKAGE_PRIVATE_VERIFIED"


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] not in ("before", "after"):
        print("GHCR_PRIVACY_CHECK_USAGE")
        return 2
    token = sys.stdin.buffer.readline(4097).strip().decode("ascii", errors="ignore")
    ok, status = visibility_gate(argv[0], token=token)
    print(status)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
