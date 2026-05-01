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


RUN apt-get update && apt-get install -y python3 python3-pip python3-venv --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Python worker deps in a venv
COPY worker/requirements.txt ./worker/requirements.txt
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir -r worker/requirements.txt

COPY --from=web-builder /app/.next/standalone ./
COPY --from=web-builder /app/.next/static ./.next/static
COPY --from=web-builder /app/public ./public
COPY --from=web-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=web-builder /app/node_modules/@prisma ./node_modules/@prisma
COPY worker/ ./worker/

ENV PATH="/venv/bin:$PATH"
ENV NODE_ENV=production
ENV JOBS_DIR=/data/jobs
ENV NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p /data/jobs
EXPOSE 8080

CMD ["sh", "-c", "PORT=8080 node server.js"]
