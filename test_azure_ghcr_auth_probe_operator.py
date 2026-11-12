#!/usr/bin/env python3
"""Offline guard tests for exact manual GHCR auth probe; no Azure or network calls."""
import importlib.util
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
