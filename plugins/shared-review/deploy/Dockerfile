# The shared review server as one container image: plain Node, no dependencies.
# Build it from the plugin's folder (plugins/shared-review):
#   docker build -f deploy/Dockerfile -t registry.example.com/shared-review:0.1.0 .
# Configure it with REVIEW_* variables (see README.md, "The review server's settings").
FROM node:22-alpine

WORKDIR /app
COPY review/ ./review/

ENV NODE_ENV=production \
    REVIEW_LISTEN=0.0.0.0:8080 \
    REVIEW_DATA_DIR=/data

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/_review/health >/dev/null || exit 1

CMD ["node", "review/main.mjs", "serve"]
