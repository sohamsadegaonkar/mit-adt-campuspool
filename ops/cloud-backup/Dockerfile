# Purpose-built worker: Node 22, PostgreSQL 17 client and AGE.
# Explicit file COPY avoids ever packaging accidental local dumps or secrets.
# No production workload starts on image launch: default command is --preflight.
FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS deps
WORKDIR /deps
COPY ops/cloud-backup/package.json ops/cloud-backup/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM postgres:17-bookworm@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends age ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /usr/local/bin/gosu
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
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
