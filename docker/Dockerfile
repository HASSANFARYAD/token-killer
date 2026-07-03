FROM node:20-alpine AS base
WORKDIR /app

# Install server dependencies
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev

# Copy application code
COPY src/ ./src/
COPY bin/ ./bin/
COPY server/ ./server/
COPY package.json ./

# Create non-root user
RUN addgroup -g 1001 -S rtk && adduser -S -u 1001 -G rtk rtk
RUN mkdir -p /data && chown rtk:rtk /data
USER rtk

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENV NODE_ENV=production
ENV RTK_DB_PATH=/data/rtk.db
ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["node", "server/index.js"]
