# Install dependencies for the same Node 20 runtime used by the app. Native
# dependencies use their Node 20 prebuilt binaries; no Debian apt access needed.
FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json ./
# Build native dependencies against this image's Node runtime. Prebuilt
# better-sqlite3 binaries can depend on a host-specific libnode shared library.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ wireguard-tools \
    && npm_config_build_from_source=true npm ci --omit=dev \
    && apt-get purge -y --auto-remove python3 make g++ \
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
