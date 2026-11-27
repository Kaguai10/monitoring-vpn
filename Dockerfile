# Install dependencies for the same Node 20 runtime used by the app.
FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json ./
# Use the Node 20 prebuilt native addon and verify that SQLite loads in this image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends wireguard-tools \
    && npm ci --omit=dev \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# Ensure the native SQLite addon loads in the actual runtime image.
RUN test -f node_modules/better-sqlite3/package.json \
    && node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); if (db.prepare('SELECT 1 AS value').get().value !== 1) process.exit(1); db.close();"

# Buat direktori data untuk SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DEBIAN_FRONTEND=noninteractive

EXPOSE 3000

# Health check menggunakan node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const http=require('http');const r=http.get('http://localhost:3000/health',res=>{process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),3000)"

CMD ["node", "src/server.js"]
