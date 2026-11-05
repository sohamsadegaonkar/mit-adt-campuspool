# Hardened minimal Node 22 + PostgreSQL 17 client CLI + AGE; source candidate only.
# All releases require signed digest, reviewed PGDG key/package provenance and passing CVE gate.
# The worker defaults to preflight and is NOT approved for Azure execution.
FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS deps
WORKDIR /deps
COPY ops/cloud-backup/package.json ops/cloud-backup/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9
ENV DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl age; \
    install -d -m 0755 /usr/share/postgresql-common/pgdg; \
    curl --fail --location --silent --show-error \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    printf 'Types: deb\nURIs: https://apt.postgresql.org/pub/repos/apt\nSuites: bookworm-pgdg\nComponents: main\nSigned-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc\n' \
      > /etc/apt/sources.list.d/pgdg.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-17; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*; \
    pg_dump --version | grep '^pg_dump (PostgreSQL) 17\.'; \
    age --version; \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack; \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /opt/campuspool
COPY --from=deps /deps/node_modules ./node_modules
COPY scripts/staging-backup-guard.js ./scripts/staging-backup-guard.js
COPY scripts/azure-blob-backup.js ./scripts/azure-blob-backup.js
ENV NODE_ENV=production \
    AZURE_AUTH_MODE=managed-identity \
    CAMPUSPOOL_CLOUD_WORKER=YES
USER 65532:65532
ENTRYPOINT ["node","scripts/azure-blob-backup.js"]
CMD ["--preflight"]
