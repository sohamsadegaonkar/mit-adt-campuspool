# Purpose-built worker: Node 22, PostgreSQL 17 client and AGE.
# Explicit file COPY avoids ever packaging accidental local dumps or secrets.
# No production workload starts on image launch: default command is --preflight.
FROM node:22.23.2-bookworm-slim AS deps
WORKDIR /deps
COPY ops/cloud-backup/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

FROM postgres:17-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends age ca-certificates \
 && rm -rf /var/lib/apt/lists/*
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
