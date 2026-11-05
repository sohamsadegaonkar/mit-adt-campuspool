# Minimal Alpine 3.23 backup worker; exact image digest is pinned.
# This remains source-only: no Azure image publish or database access approved.
FROM node:22-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db AS deps
WORKDIR /deps
COPY ops/cloud-backup/package.json ops/cloud-backup/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db
RUN set -eux; \
    apk add --no-cache ca-certificates=20261020-r0 postgresql17-client=17.11-r0 age=1.2.1-r15; \
    pg_dump --version | grep -F 'pg_dump (PostgreSQL) 17.'; \
    age --version; \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack; \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /opt/campuspool
COPY --from=deps /deps/node_modules ./node_modules
COPY scripts/staging-backup-guard.js ./scripts/staging-backup-guard.js
COPY scripts/cloud-backup-runtime-security.js ./scripts/cloud-backup-runtime-security.js
COPY scripts/azure-blob-backup.js ./scripts/azure-blob-backup.js
ENV NODE_ENV=production \
    AZURE_AUTH_MODE=managed-identity \
    CAMPUSPOOL_CLOUD_WORKER=YES
USER 65532:65532
ENTRYPOINT ["node","scripts/azure-blob-backup.js"]
CMD ["--preflight"]
