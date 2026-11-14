"""Pure-offline tests; never access Azure/Key Vault or use a real password."""
import contextlib
import importlib.util
import io
import json
import pathlib
import os
import stat
import types
import unittest
from unittest.mock import patch

SRC=pathlib.Path(__file__).parent/'scripts'/'azure-staging-pg-secret-operator.py'
spec=importlib.util.spec_from_file_location('staging_pg_secret_operator', SRC)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def success(data):
    return types.SimpleNamespace(returncode=0,stdout=json.dumps(data),stderr='')

def fail(message):
    return types.SimpleNamespace(returncode=1,stdout='',stderr=message)


class SecretOperatorTests(unittest.TestCase):
    def azure(self,secret=fail('ResourceNotFound 404')):
        calls=[]
        def run(*args,**kwargs):
            calls.append(args)
            if args[:2]==('account','show'):
                return success({'Name':'Azure for Students','State':'Enabled'})
            if args[:2]==('keyvault','show'):
                return success({'Id':'/subscriptions/demo/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01',
                                'Name':'campuspool-backup-kv-01','Rbac':True,'Purge':True,'SoftDelete':True})
            if args[:2]==('rest','--method'):
                return secret
            if args[:3]==('keyvault','secret','set'):
                return success({})
            raise AssertionError('unapproved command')
        return calls,run

    def test_check_is_read_only_and_redacts_raw_azure_error(self):
        calls,run=self.azure(fail('ResourceNotFound PAT_DONT_PRINT_THIS 404'))
        out=io.StringIO()
        with patch.object(m,'az',side_effect=run),contextlib.redirect_stdout(out):
            state=m.check()
        self.assertEqual(state['status'],'NOT_FOUND')
        self.assertIn('NO_AZURE_WRITE_OR_SECRET_VALUE_READ=YES',out.getvalue())
        self.assertNotIn('PAT_DONT_PRINT_THIS',out.getvalue())
        self.assertFalse(any(a[:3]==('keyvault','secret','set') for a in calls))

    def test_present_secret_blocks_write(self):
        calls,run=self.azure(success({'Name':m.SECRET,'Enabled':True}))
        with patch.object(m,'az',side_effect=run),patch.object(m.sys.stdin,'isatty',return_value=True),\
             patch.object(m,'tmpfs_is_safe',return_value=True),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(m.Blocked):m.provision()
        self.assertFalse(any(a[:3]==('keyvault','secret','set') for a in calls))

    def test_denied_and_unknown_not_treated_as_absence(self):
        for message,category in [('Forbidden 403','DENIED'),('Unauthorized 401','UNAUTHORIZED'),('opaque','UNKNOWN')]:
            calls,run=self.azure(fail(message))
            with patch.object(m,'az',side_effect=run),contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(m.check()['status'],category)
            self.assertFalse(any(a[:3]==('keyvault','secret','set') for a in calls))

    def test_bad_subscription_and_vault_security_stop(self):
        calls,run=self.azure()
        with patch.object(m,'az',side_effect=lambda *args,**kwargs: success({'Name':'other','State':'Enabled'}) if args[:2]==('account','show') else run(*args,**kwargs)):
            with self.assertRaises(m.Blocked):m.check()

    def test_password_limits_match_cloud_worker(self):
        self.assertFalse(m.valid_password(''))
        self.assertFalse(m.valid_password('x'*2049))
        self.assertFalse(m.valid_password('bad\npassword'))
        self.assertFalse(m.valid_password('bad\0password'))
        self.assertTrue(m.valid_password('c:ol\\on'))

    def test_confirmation_failure_has_no_write(self):
        calls,run=self.azure()
        with patch.object(m,'az',side_effect=run),patch.object(m.sys.stdin,'isatty',return_value=True),\
             patch.object(m,'tmpfs_is_safe',return_value=True),patch('builtins.input',return_value='NO'),\
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(m.Blocked):m.provision()
        self.assertFalse(any(a[:3]==('keyvault','secret','set') for a in calls))

    def test_successful_create_is_one_write_with_no_password_in_argv(self):
        calls=[]
        state={'exists':False}
        def fake_az(*args,**kw):
            calls.append(args)
            if args[:2]==('account','show'):
                return success({'Name':'Azure for Students','State':'Enabled'})
            if args[:2]==('keyvault','show'):
                return success({'Id':'/subscriptions/demo/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01',
                                'Name':'campuspool-backup-kv-01','Rbac':True,'Purge':True,'SoftDelete':True})
            if args[:2]==('rest','--method'):
                return success({'Name':m.SECRET,'Enabled':True}) if state['exists'] else fail('NotFound 404')
            if args[:3]==('keyvault','secret','set'):
                state['exists']=True
                self.assertIn('--file',args)
                self.assertNotIn('--value',args)
                self.assertNotIn('SYNTHETIC_TEST_PASSWORD',args)
                self.assertEqual(args[args.index('--output')+1],'none')
                return success({})
            raise AssertionError('unexpected command')
        out=io.StringIO()
        with patch.object(m,'az',side_effect=fake_az),patch.object(m.sys.stdin,'isatty',return_value=True),\
             patch.object(m,'tmpfs_is_safe',return_value=True),patch('builtins.input',side_effect=[m.STAGING_CONFIRM_PHRASE,m.CONFIRM_PHRASE]),\
             patch.object(m.getpass,'getpass',return_value='SYNTHETIC_TEST_PASSWORD'),\
             patch.object(m,'verify_staging_password',return_value=None),contextlib.redirect_stdout(out):
            m.provision()
        writes=[a for a in calls if a[:3]==('keyvault','secret','set')]
        self.assertEqual(len(writes),1)
        self.assertNotIn('SYNTHETIC_TEST_PASSWORD',out.getvalue())
        self.assertIn('STAGING_SECRET_CREATED_AND_ARM_ENABLED_VERIFIED=YES',out.getvalue())

    def test_tmpfs_required_for_secret_creation(self):
        calls,run=self.azure()
        with patch.object(m,'az',side_effect=run),patch.object(m.sys.stdin,'isatty',return_value=True),\
             patch.object(m,'tmpfs_is_safe',return_value=False),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(m.Blocked):m.provision()
        self.assertFalse(any(a[:3]==('keyvault','secret','set') for a in calls))


    def test_private_pg_verification_uses_tls_and_only_tmpfs_password_file(self):
        synthetic='SYNTHETIC_PRIVATE_PG_PASSWORD'
        observed={}
        def fake_psql(args,env=None,**kwargs):
            self.assertEqual(args[0],'psql')
            self.assertEqual(env['PGSSLMODE'],'verify-full')
            self.assertEqual(env['PGUSER'],m.PG_USER)
            self.assertEqual(env['PGHOST'],'aws-0-ap-southeast-1.pooler.supabase.com')
            self.assertEqual(env['PGDATABASE'],'postgres')
            self.assertEqual(env['PGPORT'],'5432')
            self.assertNotIn('PGPASSWORD',env)
            self.assertNotIn(synthetic,args)
            with open(env['PGPASSFILE'],'rb') as stream:
                observed['row']=stream.read().decode()
            observed['path']=env['PGPASSFILE']
            self.assertEqual(stat.S_IMODE(os.stat(env['PGPASSFILE']).st_mode),0o600)
            return types.SimpleNamespace(returncode=0,stdout='1\n',stderr='ignore')
        out=io.StringIO()
        with patch.object(m,'tmpfs_is_safe',return_value=True), \
             patch.object(m,'staging_pg_connection',return_value=('aws-0-ap-southeast-1.pooler.supabase.com','/synthetic/cert.crt')), \
             patch.object(m.subprocess,'run',side_effect=fake_psql),contextlib.redirect_stdout(out):
            m.verify_staging_password(synthetic)
        self.assertIn(':'+synthetic+'\n',observed['row'])
        self.assertFalse(os.path.exists(observed['path']))
        self.assertIn('STAGING_PG_PASSWORD_TLS_VERIFY_FULL_PASS=YES',out.getvalue())
        self.assertNotIn(synthetic,out.getvalue())

    def test_private_pg_verification_fails_closed_on_wrong_password(self):
        with patch.object(m,'tmpfs_is_safe',return_value=True), \
             patch.object(m,'staging_pg_connection',return_value=('aws-0-ap-southeast-1.pooler.supabase.com','/synthetic/cert.crt')), \
             patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(returncode=2,stdout='',stderr='password in stderr')):
            with self.assertRaisesRegex(m.Blocked,'STAGING_PG_PASSWORD_OR_TLS_VERIFICATION_FAILED'):
                m.verify_staging_password('SYNTHETIC_WRONG_PASSWORD')

    def test_staging_host_denylist_stops_before_password_verification(self):
        with patch.dict(os.environ,{'CAMPUSPOOL_STAGING_PGHOST':'db.production.example.com','CAMPUSPOOL_STAGING_PG_CA_FILE':'/tmp/fake.crt'}):
            with self.assertRaisesRegex(m.Blocked,'STAGING_POOLER_HOST_NOT_ALLOWLISTED'):
                m.staging_pg_connection()

    def test_secret_creation_halts_if_private_pg_test_fails(self):
        calls,run=self.azure()
        with patch.object(m,'az',side_effect=run),patch.object(m.sys.stdin,'isatty',return_value=True),\
             patch.object(m,'tmpfs_is_safe',return_value=True), \
             patch('builtins.input',side_effect=[m.STAGING_CONFIRM_PHRASE,m.CONFIRM_PHRASE]),\
             patch.object(m.getpass,'getpass',return_value='SYNTHETIC_WRONG_PASSWORD'),\
             patch.object(m,'verify_staging_password',side_effect=m.Blocked('STAGING_PG_PASSWORD_OR_TLS_VERIFICATION_FAILED')),\
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(m.Blocked):m.provision()
        self.assertFalse(any(a[:3]==('keyvault','secret','set') for a in calls))

if __name__=='__main__':
    unittest.main()
