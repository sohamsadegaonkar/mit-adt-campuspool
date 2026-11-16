"""Offline fail-closed tests; no live Azure or Key Vault call permitted."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import unittest
from unittest import mock

MODULE = Path(__file__).with_name('azure-staging-ca-operator.py')
spec = importlib.util.spec_from_file_location('campuspool_ca_operator', MODULE)
ca = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ca)

CTX = {'vault': '/subscriptions/123/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01',
       'rg': '/subscriptions/123/resourceGroups/campuspool-backup-rg',
       'caller': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
       'assignment_uuid': '11111111-2222-3333-4444-555555555555',
       'assignment_url': '/subscriptions/123/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01/providers/Microsoft.Authorization/roleAssignments/11111111-2222-3333-4444-555555555555'}
RID = 'aaaaaaaa-bbbb-cccc-dddd-123456789abc'


class CaOperatorSafetyTests(unittest.TestCase):
    def test_plan_no_azure_writes_and_no_secret_reads(self):
        with mock.patch.object(ca, 'certificate', return_value=True), \
             mock.patch.object(ca, 'context', return_value=CTX), \
             mock.patch.object(ca, 'role_definition', return_value=None), \
             mock.patch.object(ca, 'assignment', return_value='ABSENT'), \
             mock.patch.object(ca, 'secret_status', return_value='NOT_FOUND'), \
             mock.patch.object(ca, 'az', side_effect=AssertionError('Unexpected Azure call')):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                _, role, assignment, secret = ca.plan()
            self.assertEqual((role, assignment, secret), (None, 'ABSENT', 'NOT_FOUND'))
            self.assertIn('NO_AZURE_WRITES_OR_SECRET_VALUE_READ=YES', buf.getvalue())

    def test_missing_certificate_prevents_plan(self):
        with mock.patch.object(ca, 'certificate', side_effect=ca.Stop('CA_FINGERPRINT_MISMATCH')), \
             mock.patch.object(ca, 'context', side_effect=AssertionError('Must stop before Azure')):
            with self.assertRaisesRegex(ca.Stop, 'CA_FINGERPRINT_MISMATCH'):
                ca.plan()

    def test_exact_role_rejects_extra_data_action(self):
        d = {'roleName': ca.ROLE, 'roleType':'CustomRole', 'name':RID,
             'assignableScopes':[CTX['rg']], 'permissions':[{'actions':[], 'notActions':[],
             'dataActions':[ca.ACTION, 'Microsoft.KeyVault/vaults/secrets/read'], 'notDataActions':[]}]}
        with mock.patch.object(ca, 'az_json', return_value=[d]):
            with self.assertRaisesRegex(ca.Stop, 'CUSTOM_ROLE_UNEXPECTED_PRIVILEGES'):
                ca.role_definition(CTX)

    def test_existing_assignment_condition_missing_blocks(self):
        doc = {'name':CTX['assignment_uuid'], 'properties':{'scope':CTX['vault'],
               'principalId':CTX['caller'], 'roleDefinitionId':'/roles/'+RID,
               'conditionVersion':'2.0', 'condition':''}}
        with mock.patch.object(ca, 'az', return_value=subprocess.CompletedProcess([], 0, stdout=ca.json.dumps(doc))):
            with self.assertRaisesRegex(ca.Stop, 'ROLE_ASSIGNMENT_BROADER_OR_CHANGED'):
                ca.assignment(CTX, RID)

    def test_denied_assignment_never_treated_as_absent(self):
        denied = subprocess.CompletedProcess([], 1, stdout='', stderr='403 Forbidden')
        with mock.patch.object(ca, 'az', return_value=denied):
            with self.assertRaisesRegex(ca.Stop, 'ROLE_ASSIGNMENT_READ_DENIED'):
                ca.assignment(CTX, RID)

    def test_existing_ca_blocks_grant(self):
        with mock.patch.object(ca, 'plan', return_value=(CTX, None, 'ABSENT', 'EXISTS_ENABLED')), \
             mock.patch.object(ca, 'approval', side_effect=AssertionError('Approval should not be asked')):
            with self.assertRaisesRegex(ca.Stop, 'EXACT_ABSENT_CA'):
                ca.grant_once()

    def test_existing_ca_blocks_import(self):
        with mock.patch.object(ca, 'plan', return_value=(CTX, RID, 'EXACT_VERIFIED', 'EXISTS_ENABLED')), \
             mock.patch.object(ca, 'az', side_effect=AssertionError('No import should run')):
            with self.assertRaisesRegex(ca.Stop, 'CA_IMPORT_REQUIRE'):
                ca.import_once()

    def test_import_missing_approval_blocks_write(self):
        with mock.patch.object(ca, 'plan', return_value=(CTX, RID, 'EXACT_VERIFIED', 'NOT_FOUND')), \
             mock.patch.object(ca, 'approval', side_effect=ca.Stop('OWNER_CONFIRMATION_MISSING')), \
             mock.patch.object(ca, 'az', side_effect=AssertionError('No import should run')):
            with self.assertRaisesRegex(ca.Stop, 'OWNER_CONFIRMATION_MISSING'):
                ca.import_once()

    def test_import_exact_file_once_and_readback(self):
        with mock.patch.object(ca, 'plan', return_value=(CTX, RID, 'EXACT_VERIFIED', 'NOT_FOUND')) as plan, \
             mock.patch.object(ca, 'approval') as confirmation, \
             mock.patch.object(ca, 'az', return_value=subprocess.CompletedProcess([],0)) as azcall, \
             mock.patch.object(ca, 'secret_status', return_value='EXISTS_ENABLED'):
            with contextlib.redirect_stdout(io.StringIO()):
                ca.import_once()
            self.assertEqual(plan.call_count, 2)
            confirmation.assert_called_once_with('IMPORT_ONLY_VALIDATED_PUBLIC_STAGING_CA_ONCE')
            azcall.assert_called_once()
            args = azcall.call_args.args
            self.assertEqual(args[:4], ('keyvault','secret','set','--vault-name'))
            self.assertEqual(args[args.index('--name')+1], ca.SECRET)
            self.assertEqual(args[args.index('--file')+1], str(ca.CA))
            self.assertNotIn('--value', args)
            self.assertNotIn('show', args)

    def test_unknown_import_outcome_no_retry(self):
        with mock.patch.object(ca, 'plan', return_value=(CTX, RID, 'EXACT_VERIFIED', 'NOT_FOUND')), \
             mock.patch.object(ca, 'approval'), \
             mock.patch.object(ca, 'az', return_value=subprocess.CompletedProcess([],1)) as azcall:
            with self.assertRaisesRegex(ca.Stop, 'CA_IMPORT_RESULT_UNKNOWN'):
                ca.import_once()
            self.assertEqual(azcall.call_count, 1)

    def test_revoke_independent_of_certificate_file(self):
        states = [(CTX,RID,'EXACT_VERIFIED','EXISTS_ENABLED'), (CTX,RID,'EXACT_VERIFIED','EXISTS_ENABLED')]
        with mock.patch.object(ca, 'plan', side_effect=states) as plan, \
             mock.patch.object(ca, 'approval'), \
             mock.patch.object(ca, 'az', return_value=subprocess.CompletedProcess([],0)) as azcall, \
             mock.patch.object(ca, 'assignment', return_value='ABSENT'):
            with contextlib.redirect_stdout(io.StringIO()):
                ca.revoke_once()
            self.assertEqual(plan.call_count, 2)
            for call in plan.call_args_list:
                self.assertEqual(call.kwargs, {'validate_certificate':False})
            self.assertEqual(azcall.call_args.args[:3], ('role','assignment','delete'))

    def test_revoke_only_exact_role(self):
        with mock.patch.object(ca, 'plan', return_value=(CTX,None,'UNKNOWN','NOT_FOUND')):
            with self.assertRaisesRegex(ca.Stop, 'NOT_OUR_EXACT_GRANT'):
                ca.revoke_once()


if __name__ == '__main__':
    unittest.main()
