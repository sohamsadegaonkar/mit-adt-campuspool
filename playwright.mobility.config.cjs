'use strict';
const {defineConfig,devices}=require('@playwright/test');

// Hard-stop on accidental connection to real staging or production.
if(process.env.QA_DISPOSABLE_POSTGIS!=='YES')
  throw Error('Browser QA requires QA_DISPOSABLE_POSTGIS=YES');
const db=process.env.OTP_DATABASE_URL;
if(!db || !['127.0.0.1','localhost','[::1]'].includes(new URL(db).hostname))
  throw Error('Browser QA only accepts a disposable loopback PostgreSQL database');

const port=4188;
const basicPassword='ci-only-mobility-browser-qa-no-real-secret';
module.exports=defineConfig({
  testDir:'./e2e',
  testMatch:'mobility.spec.cjs',
  timeout:45000,
  expect:{timeout:12000},
  fullyParallel:false,
  workers:1,
  retries:process.env.CI?1:0,
  forbidOnly:!!process.env.CI,
  reporter:process.env.CI?[['list'],['html',{outputFolder:'playwright-report',open:'never'}]]:[['list']],
  outputDir:'test-results/mobility',
  use:{
    baseURL:'http://127.0.0.1:'+port,
    httpCredentials:{username:'staging',password:basicPassword},
    timezoneId:'UTC',
    trace:'retain-on-failure',
    screenshot:'only-on-failure',
    video:'retain-on-failure'
  },
  projects:[
    {name:'chromium-desktop',use:{...devices['Desktop Chrome'],browserName:'chromium'}},
    {name:'firefox-desktop',use:{...devices['Desktop Firefox'],browserName:'firefox'}},
    {name:'webkit-mobile',use:{...devices['iPhone 13'],browserName:'webkit'}}
  ],
  webServer:{
    command:'node server.js',
    url:'http://127.0.0.1:'+port+'/healthz',
    reuseExistingServer:false,
    timeout:45000,
    env:{
      ...process.env,
      PORT:String(port),
      APP_ENV:'staging',
      // CI uses HTTP loopback; production requires HTTPS same-origin and must not be spoofed here.
      NODE_ENV:'test',
      ENABLE_CLUSTER:'false',
      AUTH_OTP_BACKEND:'postgres',
      RIDES_BACKEND:'postgres',
      MOBILITY_MATCHING_ENABLED:'true',
      OTP_DB_SSL:'false',
      OTP_HMAC_KEY:'ci-only-browser-qa-hmac-key-not-a-real-secret',
      OTP_SECRET:'ci-only-browser-qa-otp-secret-not-a-real-secret',
      STAGING_BASIC_AUTH_PASSWORD:basicPassword,
      EMAIL_PROVIDER:'disabled',
      SMS_PROVIDER:'disabled',
      DATABASE_PATH:'/tmp/campuspool-e2e-mobility-synthetic.sqlite'
    },
    stdout:'ignore',
    stderr:'pipe'
  }
});