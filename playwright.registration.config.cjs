'use strict';
const {defineConfig}=require('@playwright/test');
const db=new URL(process.env.OTP_DATABASE_URL||'http://invalid');
if(process.env.QA_DISPOSABLE_REGISTRATION!=='YES'||db.hostname!=='127.0.0.1'||
   db.pathname!=='/campuspool_registration_browser_test'||!process.env.REGISTRATION_FIXTURE_DIR)
  throw Error('Registration E2E requires a disposable loopback database and fixture directory');
module.exports=defineConfig({
  testDir:'./e2e',testMatch:'registration.spec.cjs',timeout:90000,expect:{timeout:12000},
  workers:1,retries:0,forbidOnly:!!process.env.CI,reporter:[['list',{printSteps:true}]],
  outputDir:'test-results/registration',
  use:{baseURL:'https://127.0.0.1:4199',ignoreHTTPSErrors:true,browserName:'chromium',
    serviceWorkers:'block',actionTimeout:12000,navigationTimeout:20000,httpCredentials:{origin:'https://127.0.0.1:4199',username:'staging',password:'synthetic-registration-browser-basic-not-live'}},
  webServer:{command:'node e2e/registration-test-server.cjs',url:'https://127.0.0.1:4199/healthz',
    ignoreHTTPSErrors:true,reuseExistingServer:false,timeout:45000,stdout:'pipe',stderr:'pipe'}
});
