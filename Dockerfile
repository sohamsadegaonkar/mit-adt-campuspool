# Production Dockerfile for MIT ADT CampusPool
FROM node:20-alpine

# Install build dependencies required for compiling better-sqlite3 native bindings
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Expose server port
EXPOSE 3000
ENV PORT=3000

# Start production server
CMD ["node", "server.js"]
