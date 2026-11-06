import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location("cost_evidence",Path("scripts/azure_31day_cost_evidence.py"))
cost=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cost)

def report(rows,extra=None):
    return {
        "properties":{
            "columns":[{"name":"ServiceName"},{"name":"Currency"},{"name":"PreTaxCost"},{"name":"CostStatus"}],
            "rows":rows,
            "nextLink":None,
            **(extra or {})
        },
        # Azure response might contain account identifiers: never print them.
        "id":"/subscriptions/SENSITIVE_ACCOUNT_SCOPE/providers/Microsoft.CostManagement"
    }

class CostEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.actual=report([["Storage","INR",1.234,"Actual"],["Container Apps","INR",2.000,"Actual"]])
        self.forecast=report([["Storage","INR",4.000,"Forecast"],["Container Apps","INR",3.250,"Forecast"]])

    def test_account_pretax_not_budget_go(self):
        result=cost.review(self.actual,self.forecast)
        self.assertEqual(result["status"],"PRETAX_AZURE_ACCOUNT_EVIDENCE_ONLY")
        self.assertEqual(result["actual_trailing_31_days"]["pretax_total_inr"],"3.23")
        self.assertEqual(result["forecast_next_31_days"]["pretax_total_inr"],"7.25")
        self.assertFalse(result["budget_pass"])
        self.assertFalse(result["provisioning_authorized"])
        self.assertFalse(result["staging_export_authorized"])
        self.assertFalse(result["independent_restore_verified"])
        self.assertNotIn("SENSITIVE_ACCOUNT_SCOPE",str(result))

    def test_unavailable_and_malformed_data_fail_closed(self):
        for changed in [
            report([]),
            report([["Storage","USD",1,"Actual"]]),
            report([["Storage","INR",-1,"Actual"]]),
            report([["Storage","INR","NaN","Actual"]]),
            report([["Storage","INR",0,"Actual"]],{"nextLink":"http://next"}),
            report([["Storage","INR",1,"Actual"]],{"columns":[{"name":"Cost"}]}),
            report([["Storage/../secret","INR",1,"Actual"]]),
            report([["Storage","INR",1]])
        ]:
            with self.assertRaises(cost.EvidenceBlocked):
                cost.review(changed,self.forecast)

    def test_forecast_cannot_appear_as_actual(self):
        with self.assertRaises(cost.EvidenceBlocked):
            cost.review(self.actual,report([["Storage","INR",0,"Actual"]]))

    def test_forecast_still_not_approved_when_zero(self):
        result=cost.review(self.actual,report([["Storage","INR",0,"Forecast"]]))
        self.assertFalse(result["budget_pass"])

    def test_wrong_schema_or_duplicate_columns(self):
        a=report([["Storage","INR",1,"Actual"]],{
            "columns":[{"name":"ServiceName"},{"name":"Currency"},{"name":"PreTaxCost"},{"name":"PreTaxCost"}]
        })
        with self.assertRaises(cost.EvidenceBlocked):
            cost.review(a,self.forecast)

if __name__=="__main__":
    unittest.main()
