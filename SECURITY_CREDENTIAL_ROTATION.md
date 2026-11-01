# CampusPool — emergency credential rotation and exposure response
Date opened: 2026-11-01
Status: **ACTION REQUIRED FROM ACCOUNT OWNER — credentials NOT confirmed revoked or replaced**

## Confirmed exposures (no secret values reproduced)

- `SMTP_PASS`: the **same hardcoded Google SMTP App Password** was committed to `.env.production`, `render.yaml`, and `vercel.json`. It must be revoked in the owning Google Account.
- `OTP_SECRET`: a non-placeholder signing secret was committed to `.env.production`, and backend code included a predictable fallback. Replace it with a fresh cryptographically generated secret and invalidate earlier OTP tokens.
- `SMTP_USER` and `SMTP_FROM`: sender identifiers were committed. While not passwords, avoid placing unnecessary account details in public infrastructure files.
- `SMS_API_KEY`: the entry in the committed environment file appears to be a placeholder; no usable key was confirmed. Check the actual SMS provider dashboard separately, if any account exists.
- `campuspool.db` and `campuspool_database.json`: runtime data files were committed. Even if sample/empty today, never track these, and evaluate any personal data included in historical revisions.
- `vercel.json` contained a second copy of the SMTP password (same credential, not a distinct password).
- Main-branch history has 12 commits in the inspected period (2026-10-28 through 2026-10-31). A pattern-based review of changed files and deployment configs found the items above; this **does not prove no other secrets or personal records exist** in binaries, forks, clones, pull-request diffs, GitHub caches or other systems.

## Do these manual actions immediately, in order

1. **Revoke the compromised Gmail App Password:** Open <https://myaccount.google.com/apppasswords> while signed into the Google Account that owns the CampusPool SMTP sender. Locate the App Password used by CampusPool and select **Remove**. If unsure which label it uses, revoke all unused app passwords rather than retaining an exposed credential. **We cannot revoke Google App Passwords through the connected Gmail API.**
2. **Generate replacement:** With Google 2-Step Verification enabled, generate a new unique App Password only if Gmail SMTP must remain your delivery method. Do not reuse a previously exposed password. Google App Passwords are shown only once; copy directly to the private Render settings (never to GitHub, chat, logs, or an issue). Consider using a transactional email API provider rather than Gmail SMTP for production.
3. **Update Render production environment privately:** Render Dashboard → your actual CampusPool web service → **Environment**. Replace `SMTP_PASS`, and verify `SMTP_USER` and `SMTP_FROM` point to the intended sender. Set a newly generated `OTP_SECRET` (at least 32 random bytes, e.g. output from `openssl rand -hex 32`; generate privately). Save and choose **Save and deploy** (or the corresponding deploy action) so the running process receives the new variables. `Save only` does not apply changes to a running service. Check email delivery and sign-in after deploy.
4. **If Vercel also hosts any copy:** Project → Settings → Environment Variables. Replace private values there too, or disable/remove the unused deployment. No credentials should remain in `vercel.json`.
5. **Apply emergency cleanup:** Review/merge the emergency PR against `main` only after private credentials are rotated and the deployment is prepared for the loss of the committed `.env.production` file. The PR removes secret-bearing files from the latest branch tree, not from historical commits.
6. **Review access evidence:** Check Google Account → Security → Recent security activity; Gmail sent mail for unexplained deliveries; Render dashboard environment/config/deploy history and logs; Vercel if used; and GitHub Security → Secret scanning alerts. Capture indicators without distributing raw credentials.
7. **Evaluate Git-history cleanup:** Revoke first. History rewriting with `git-filter-repo` can disrupt collaborators, PRs, commits and deployment references, and copies may still remain in forks/clones. Follow GitHub's official procedure only as a coordinated, separately approved maintenance operation.
8. **Verify:** Confirm the revoked password no longer authenticates (without repeatedly trying it against a production provider), the new password sends a test OTP to a controlled test account, Render has the current `OTP_SECRET`, and no sensitive source files are re-added. Record time, approver and evidence privately.

## What this emergency branch changes

- Deletes `.env.production`, `campuspool.db`, `campuspool_database.json` from the **current Git tree only**.
- Replaces Render Blueprint `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` literal values with private `sync: false` inputs.
- Removes Vercel's inline SMTP identifiers/password from `vercel.json`.
- Adds `.env*`, database, and key material ignore patterns to Git and Docker ignore rules.
- Removes the known hardcoded `OTP_SECRET` fallback; production now requires an explicitly configured strong value.
- Adds a no-secret-commit CI guard.

**Not accomplished by this PR:** Revoking credentials in Google; changing actual Render/Vercel environment variables; purging old Git history; auditing Google account activity; production deployment; end-to-end email delivery verification.

## References

- Google: <https://support.google.com/accounts/answer/185833>
- Render environment settings: <https://render.com/docs/configure-environment-variables>
- GitHub sensitive history: <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository>
- GitHub leaked secret response: <https://docs.github.com/en/code-security/tutorials/remediate-leaked-secrets/remediating-a-leaked-secret>

**Never share a newly generated App Password, OTP secret or API key in a chat or pull-request comment.**
