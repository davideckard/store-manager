# Stage 1 — Next.js build
FROM node:20-slim AS web-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 2 — Runtime
FROM node:20-slim
WORKDIR /app

ARG CACHEBUST=2
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Python worker deps in a venv
COPY worker/requirements.txt ./worker/requirements.txt
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir -r worker/requirements.txt

COPY --from=web-builder /app/.next/standalone ./
COPY --from=web-builder /app/.next/static ./.next/static
COPY --from=web-builder /app/public ./public
COPY --from=web-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=web-builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=web-builder /app/prisma ./prisma
COPY package*.json ./
RUN npm install prisma --no-save --ignore-scripts
COPY worker/ ./worker/

ENV PATH="/venv/bin:$PATH"
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV JOBS_DIR=/data/jobs
ENV NEXT_TELEMETRY_DISABLED=1

COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e

echo "Starting store-manager..."

# Ensure job log directory exists (volume mount replaces build-time mkdir)
mkdir -p /data/jobs

# Run migrations
echo "Running database migrations..."
npx prisma migrate deploy || {
  echo "WARNING: Migration failed, continuing anyway..."
}

echo "Starting Next.js server..."
exec node /app/server.js
echo "Stopped"
EOF

RUN chmod +x /app/start.sh

EXPOSE 8080
CMD ["/app/start.sh"]
