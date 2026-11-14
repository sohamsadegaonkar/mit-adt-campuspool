import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location(
    "azure_cost_error_sanitize",Path("scripts/azure_cost_error_sanitize.py")
)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class AzureCostErrorSanitizeTests(unittest.TestCase):
    def test_access_denied_never_prints_private_data(self):
        payload=(
            "ERROR: (AuthorizationFailed) The client 'private-user@company.com' "
            "with object id '11111111-2222-3333-4444-555555555555' "
            "cannot access https://management.azure.com/subscriptions/SECRET\n"
            "Response status: 403 Bearer abc123_sensitive_token"
        )
        safe=mod.diagnose(payload)
        self.assertEqual(safe["HTTP_STATUS"],"403")
        self.assertEqual(safe["ERROR_CODE"],"AuthorizationFailed")
        self.assertEqual(safe["CATEGORY"],"ACCESS_REVIEW")
        self.assertFalse(safe["BUDGET_GATE"]=="PASS")
        joined=str(safe)
        for secret in ("private-user", "11111111", "SECRET", "Bearer", "abc123"):
            self.assertNotIn(secret,joined)

    def test_request_and_offer_codes_are_distinct(self):
        for source,category in [
            ("BadRequest: invalid timePeriod", "REQUEST_REVIEW"),
            ("ERROR: (SubscriptionTypeNotSupported)", "OFFER_SCOPE_REVIEW"),
            ("HTTP/1.1 404 Not Found", "SCOPE_REVIEW"),
            ("HTTP 429 Too Many Requests", "RETRY_LATER"),
            ("status code: 503", "AZURE_RETRY_LATER"),
            ("ERROR: (BillingAccessDenied)", "ACCESS_REVIEW"),
        ]:
            self.assertEqual(mod.diagnose(source)["CATEGORY"],category)

    def test_unknown_error_is_redacted(self):
        payload="ERROR: token=ghp_TEST_UNSAFE_SECRET billing@example.com"
        self.assertEqual(mod.diagnose(payload)["ERROR_CODE"],"UNCLASSIFIED")
        self.assertEqual(mod.diagnose(payload)["PRIVATE_AZURE_ERROR"],"REDACTED")
        self.assertNotIn("TEST_UNSAFE_SECRET",str(mod.diagnose(payload)))

    def test_fake_code_is_never_emitted(self):
        raw="ERROR: (UserAccount-abc-def-X) HTTP status=418"
        self.assertEqual(mod.diagnose(raw)["ERROR_CODE"],"UNCLASSIFIED")
        self.assertEqual(mod.diagnose(raw)["HTTP_STATUS"],"UNKNOWN")


if __name__=="__main__":
    unittest.main()
