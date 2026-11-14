#!/usr/bin/env python3
"""Offline guard tests for exact manual GHCR auth probe; no Azure or network calls."""
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent
P = ROOT / "scripts" / "azure-ghcr-auth-probe-operator.py"
SPEC = importlib.util.spec_from_file_location("ghcr_auth_probe", P)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class TestGhcrAuthProbe(unittest.TestCase):
    def setUp(self):
        self.sub = "11111111-1111-4111-8111-111111111111"
        self.uai = (f"/subscriptions/{self.sub}/resourceGroups/{probe.RG}"
                    "/providers/Microsoft.ManagedIdentity/userAssignedIdentities/campuspool-ghcr-vault-reader")
        self.env = (f"/subscriptions/{self.sub}/resourceGroups/{probe.RG}"
                    "/providers/Microsoft.App/managedEnvironments/campuspool-backup-standard-env")

    def test_exact_isolated_manifest(self):
        m = probe.manifest(self.uai, self.env)
        p = m["properties"]
        c = p["configuration"]
        self.assertEqual(c["triggerType"], "Manual")
        self.assertEqual(c["replicaRetryLimit"], 0)
        self.assertEqual(c["replicaTimeout"], 120)
        self.assertEqual(c["registries"], [])
        self.assertEqual(len(c["secrets"]), 1)
        self.assertEqual(c["secrets"][0]["name"], "ghcr-pull-token")
        self.assertEqual(c["secrets"][0]["identity"], self.uai)
        self.assertNotIn("value", c["secrets"][0])
        t = p["template"]
        self.assertEqual(t["volumes"], [])
        self.assertEqual(t["initContainers"], [])
        self.assertEqual(len(t["containers"]), 1)
        x = t["containers"][0]
        self.assertTrue(x["image"].startswith("docker.io/library/node:"))
        self.assertIn("@sha256:", x["image"])
        self.assertEqual(x["env"], [{"name": "GHCR_PROBE_TOKEN", "secretRef": "ghcr-pull-token"}])
        self.assertEqual(x["command"], ["node", "-e"])
        self.assertEqual(x["args"], [probe.NODE_CODE])
        self.assertNotIn("database", json.dumps(m).lower().replace('"no-database": "true"', ''))
        self.assertNotIn("blob", json.dumps(m).lower())
        doc = {"id": probe.path(self.sub), **m}
        probe.verify_doc(doc, self.uai, self.env, self.sub)

    def test_azure_arm_region_display_name_normalization(self):
        doc = {"id": probe.path(self.sub), **probe.manifest(self.uai, self.env)}
        # Azure ARM often returns the display spelling rather than the
        # compact location name. Both should identify the exact same region.
        doc["location"] = "Malaysia West"
        probe.verify_doc(doc, self.uai, self.env, self.sub)
        doc["location"] = "MALAYSIA WEST"
        probe.verify_doc(doc, self.uai, self.env, self.sub)
        # Do not broaden acceptance to any other region.
        doc["location"] = "East US"
        with self.assertRaisesRegex(probe.Stop, "WRONG_PROBE_REGION"):
            probe.verify_doc(doc, self.uai, self.env, self.sub)

    def test_guard_detects_manifest_tampering(self):
        doc = {"id": probe.path(self.sub), **probe.manifest(self.uai, self.env)}
        doc["properties"]["template"]["containers"][0]["command"] = ["sh"]
        with self.assertRaises(probe.Stop):
            probe.verify_doc(doc, self.uai, self.env, self.sub)

    def test_azure_default_ephemeral_storage_one_gi_is_only_allowed_extra(self):
        # The job requests 0.25 vCPU. Azure documents 1 GiB of available
        # ephemeral storage for <=0.25 vCPU and may echo this back in ARM.
        doc = {"id": probe.path(self.sub), **probe.manifest(self.uai, self.env)}
        resources = doc["properties"]["template"]["containers"][0]["resources"]
        resources["ephemeralStorage"] = "1Gi"
        probe.verify_doc(doc, self.uai, self.env, self.sub)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertTrue(probe.diagnose_template(doc, self.uai, self.env))
        self.assertIn("GHCR_AUTH_PROBE_DIAG_CONTAINER_RESOURCES_MATCH=YES", out.getvalue())
        self.assertNotIn("1Gi", out.getvalue())

        resources["ephemeralStorage"] = "2Gi"
        with self.assertRaisesRegex(probe.Stop, "PROBE_TEMPLATE_CHANGED"):
            probe.verify_doc(doc, self.uai, self.env, self.sub)
        resources["ephemeralStorage"] = "1Gi"
        resources["gpu"] = "1"
        with self.assertRaisesRegex(probe.Stop, "PROBE_TEMPLATE_CHANGED"):
            probe.verify_doc(doc, self.uai, self.env, self.sub)
        resources.pop("gpu")
        resources["cpu"] = 1
        with self.assertRaisesRegex(probe.Stop, "PROBE_TEMPLATE_CHANGED"):
            probe.verify_doc(doc, self.uai, self.env, self.sub)

    def test_observed_azure_empty_ephemeral_storage_is_allowed(self):
        # The owner independently observed this exact ARM resource projection:
        # {cpu: 0.25, ephemeralStorage: "", memory: "0.5Gi"}.
        doc = {"id": probe.path(self.sub), **probe.manifest(self.uai, self.env)}
        resources = doc["properties"]["template"]["containers"][0]["resources"]
        resources["ephemeralStorage"] = ""
        probe.verify_doc(doc, self.uai, self.env, self.sub)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertTrue(probe.diagnose_template(doc, self.uai, self.env))
        self.assertIn("GHCR_AUTH_PROBE_DIAG_CONTAINER_RESOURCES_MATCH=YES", output.getvalue())
        self.assertNotIn("ephemeralStorage", output.getvalue())

        for disallowed in (None, False, 0, "0Gi", "2Gi", "unknown", {}):
            with self.subTest(disallowed=disallowed):
                resources["ephemeralStorage"] = disallowed
                with self.assertRaisesRegex(probe.Stop, "PROBE_TEMPLATE_CHANGED"):
                    probe.verify_doc(doc, self.uai, self.env, self.sub)
        resources["ephemeralStorage"] = ""
        resources["disk"] = ""
        with self.assertRaisesRegex(probe.Stop, "PROBE_TEMPLATE_CHANGED"):
            probe.verify_doc(doc, self.uai, self.env, self.sub)

    def test_diagnose_reports_only_boolean_field_checks_no_template_values(self):
        doc = {"id": probe.path(self.sub), **probe.manifest(self.uai, self.env)}
        # Simulate a tampered script and a secret-like extra value. Diagnostic
        # must not display either the payload or its original template source.
        secret = "SYNTHETIC_CREDENTIAL_MUST_NOT_APPEAR_IN_OUTPUT"
        doc["properties"]["template"]["containers"][0]["args"] = [secret]
        doc["properties"]["template"]["containers"][0]["env"] = [
            {"name": "GHCR_PROBE_TOKEN", "value": secret}
        ]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            matched = probe.diagnose_template(doc, self.uai, self.env)
        msg = output.getvalue()
        self.assertFalse(matched)
        self.assertIn("GHCR_AUTH_PROBE_DIAG_CONTAINER_ARGS_MATCH=NO", msg)
        self.assertIn("GHCR_AUTH_PROBE_DIAG_CONTAINER_ENV_MATCH=NO", msg)
        self.assertIn("NO_AZURE_WRITE_OR_JOB_START=YES", msg)
        self.assertNotIn(secret, msg)
        self.assertNotIn(probe.NODE_CODE, msg)
        self.assertNotIn(probe.IMAGE, msg)

    def test_fixed_hosts_no_user_input_or_credential_log(self):
        node = probe.NODE_CODE
        self.assertIn("https://ghcr.io/token?", node)
        self.assertIn("https://ghcr.io/v2/", node)
        self.assertIn("redirect:\"error\"", node)
        self.assertIn("method:\"HEAD\"", node)
        self.assertNotIn("console.log(pat)", node)
        self.assertNotIn("JSON.stringify(obj)", node)
        self.assertNotIn("Authorization);", node)
        self.assertNotIn("https://management.azure.com", node)
        self.assertNotIn("http://", node)

    @unittest.skipUnless(shutil.which("node"), "Node is needed for synthetic tests")
    def test_synthetic_no_network_success_and_failures_no_secret_output(self):
        secret = "SYNTHETIC_ONLY_NOT_REAL_PAT_123456789"
        for case, expected_status, expected_rc in (
            ("ok", "GHCR_AUTH_PROBE_PINNED_MANIFEST_READ_PASS=YES", 0),
            ("unauthorized", "GHCR_AUTH_PROBE_MANIFEST_HEAD_HTTP_401", 2),
            ("forbidden", "GHCR_AUTH_PROBE_MANIFEST_HEAD_HTTP_403", 2),
            ("missing", "GHCR_AUTH_PROBE_MANIFEST_HEAD_HTTP_404", 2),
            ("bad_digest", "GHCR_AUTH_PROBE_MANIFEST_DIGEST_MISMATCH_OR_MISSING", 2),
            ("token_forbidden", "GHCR_AUTH_PROBE_TOKEN_ENDPOINT_HTTP_403", 2),
        ):
            with self.subTest(case=case):
                status = {"unauthorized": 401, "forbidden": 403, "missing": 404}.get(case, 200)
                digest = probe.EXPECTED_DIGEST if case != "bad_digest" else "sha256:" + "0"*64
                # Both responses are controlled by local mock; no real fetch or creds.
                mock = (
                    "globalThis.fetch=async(url,opt)=>{"
                    "if(url.includes('/token?'))return {ok:" +
                    ("false,status:403" if case == "token_forbidden" else "true,status:200") +
                    ",json:async()=>({token:'SYNTHETIC_BEARER'})};"
                    f"return {{ok:{str(status == 200).lower()},status:{status},"
                    "headers:{get:()=>'" + digest + "'}};};\n"
                )
                result = subprocess.run(
                    ["node", "-e", mock + probe.NODE_CODE],
                    env={**os.environ, "GHCR_PROBE_TOKEN": secret},
                    capture_output=True, text=True, timeout=6,
                )
                self.assertEqual(result.returncode, expected_rc)
                self.assertIn(expected_status, result.stdout)
                self.assertNotIn(secret, result.stdout + result.stderr)
                self.assertNotIn("SYNTHETIC_BEARER", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
