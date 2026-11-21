import importlib.util
import io
import json
import unittest
import urllib.error
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "ghcr_privacy", Path("scripts/ghcr_private_package_check.py")
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class Response:
    def __init__(self, data):
        self.data = data
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def read(self, size):
        return self.data[:size]


def fake_package(*, visibility="private", owner="sohamsadegaonkar", name="campuspool-backup-worker"):
    return json.dumps({
        "name": name,
        "package_type": "container",
        "owner": {"login": owner},
        "visibility": visibility
    }).encode()


class PrivateGhcrPackageTests(unittest.TestCase):
    def check(self, mode, data, *, token="ghp_FAKE_NEVER_VALID"):
        def opener(req, timeout):
            self.assertEqual(req.full_url, gate.API_URL)
            self.assertEqual(req.get_header("Authorization"), "Bearer " + token)
            self.assertEqual(timeout, 15)
            return Response(data)
        return gate.visibility_gate(mode, token=token, opener=opener)

    def test_private_package_allowed_before_and_after(self):
        for mode in ("before", "after"):
            allowed, status = self.check(mode, fake_package())
            self.assertTrue(allowed)
            self.assertEqual(status, "GHCR_PERSONAL_CONTAINER_PACKAGE_PRIVATE_VERIFIED")

    def test_first_publish_404_allowed_only_before(self):
        def missing(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 404, "secret info", {}, io.BytesIO())
        allowed, status = gate.visibility_gate("before", token="fake", opener=missing)
        self.assertTrue(allowed)
        self.assertEqual(status, "GHCR_PACKAGE_NOT_FOUND_FIRST_PUSH_WILL_DEFAULT_PRIVATE")
        allowed, status = gate.visibility_gate("after", token="fake", opener=missing)
        self.assertFalse(allowed)
        self.assertEqual(status, "GHCR_PRIVACY_API_HTTP_BLOCKED")

    def test_public_or_other_identity_blocked(self):
        for data in (
            fake_package(visibility="public"),
            fake_package(visibility="internal"),
            fake_package(owner="malicious-user"),
            fake_package(name="unrelated-image"),
            b'{"name":"campuspool-backup-worker","visibility":"private"}',
            b"not JSON",
            b"x" * 33000,
        ):
            for mode in ("before", "after"):
                allowed, _ = self.check(mode, data)
                self.assertFalse(allowed)

    def test_access_denied_redacts_entire_message(self):
        token = "ghp_FAKE_SECRET_IN_MEMORY_ONLY"
        def forbidden(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 403,
                "token=" + token + " owner-email@secret.invalid", {}, io.BytesIO(token.encode()))
        ok, status = gate.visibility_gate("before", token=token, opener=forbidden)
        self.assertFalse(ok)
        self.assertEqual(status, "GHCR_PRIVACY_API_HTTP_BLOCKED")
        self.assertNotIn(token, status)
        self.assertNotIn("secret.invalid", status)

    def test_refuse_wrong_mode_and_blank_token(self):
        for mode, token in (("unknown", "t"), ("before", ""), ("after", "x" * 4097)):
            allowed, _ = gate.visibility_gate(mode, token=token, opener=lambda *a: None)
            self.assertFalse(allowed)


if __name__ == "__main__":
    unittest.main()
