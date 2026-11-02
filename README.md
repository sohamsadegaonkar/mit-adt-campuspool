# MIT-ADT CampusPool

Student ridesharing and bike-pooling application for MIT Art, Design and Technology University, Pune.

## Status

**Security and release hardening consolidated (2026-11-02).** Repository cleanup is not a production launch approval. Live user signup, payment settlement and verified provider delivery must not be represented as complete without end-to-end confirmation.

The app uses a Node.js HTTP server with a server-rendered/static single-page UI. Authentication can use PostgreSQL with \`AUTH_OTP_BACKEND=postgres\`; legacy Rides and bookings are still managed by SQLite. **Local SQLite on Render Free is not durable production storage.**

The separate CampusPool 2 rides/errands UI prototype is preserved under [\`prototypes/campuspool-2/\`](prototypes/campuspool-2/README.md). It is not the live backend.

## Start locally

1. Use Node.js **22.23.2** (compatible with the installed native SQLite package).
2. Run \`npm ci\`.
3. For development, provide appropriate private environment variables; never commit \`.env\` files.
4. Run \`npm start\`. For the PostgreSQL auth feature, apply \`npm run migrate:otp\` to a **separate test database** before setting \`AUTH_OTP_BACKEND=postgres\`.

## Verify

\`\`\`bash
npm run test:secrets
npm run test:security
npm run test:auth
npm run test:native
npm run test:production-auth
npm run test:release
npm run check:release-ci
# The following integration tests require an ISOLATED test PostgreSQL database:
npm run test:stage1
npm run test:identity
\`\`\`

**Never run data-changing integration tests against the live Supabase staging/production databases.**

## Deployment and credentials

- Live Render service: \`mit-adt-campuspool\`, on \`main\`.
- Separate Render staging service: \`mit-adt-campuspool-staging\` (currently configured with an old feature branch; **repoint it to \`main\` in Render before its next deployment**).
- Staging authentication database: separate Supabase project \`campuspool-staging-db\`, accessible only through the server with a restricted PostgreSQL role and certificate-verified TLS.
- Set \`OTP_SECRET\` to a fresh cryptographically secure value in the **Render private environment**. Production startup fails closed without it.
- OTP email uses a private Resend API key and a verified sender domain; SMS requires MSG91 and approved India DLT details. Missing provider settings fail closed.
- Client-reported payment success is disabled until an authenticated payment-provider callback is implemented.

See [\`SECURITY_CREDENTIAL_ROTATION.md\`](SECURITY_CREDENTIAL_ROTATION.md), [\`SECURITY_DEPLOYMENT.md\`](SECURITY_DEPLOYMENT.md), [\`SUPABASE_STAGING.md\`](SUPABASE_STAGING.md) and [\`PRODUCTION_RELEASE_GATE.md\`](PRODUCTION_RELEASE_GATE.md).

## Security incident

Previously committed credentials and runtime files were removed from the active working tree. **This does not erase them from public Git history.** The owning Google account's leaked App Password must be revoked and any exposed signing secrets rotated. Review old commits and any cloned/cached copies. Never paste real secrets in code, GitHub issues or chats.

## Development branches

This repository is being consolidated onto **\`main\` as the only long-lived Git branch**. Preserve unfinished changes in documented paths and GitHub history, not extra unreviewed deployment branches. Staging and production use separate environment settings and resources, even when they deploy the same commit.
