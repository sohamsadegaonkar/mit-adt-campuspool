# Production Dockerfile for MIT ADT CampusPool
FROM node:20-slim

WORKDIR /app

# Install build dependencies required for compiling native C++ addons like better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests first for optimal layer caching
COPY package*.json ./

# Install production dependencies (glibc prebuilts link seamlessly without musl SIGSEGV)
RUN npm install --omit=dev

# Copy application code
COPY . .

# Expose server port
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# Start production server
CMD ["node", "server.js"]
