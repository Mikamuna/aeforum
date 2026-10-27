FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json /web/
RUN npm ci --no-audit --no-fund
COPY web/index.html web/tsconfig.json web/vite.config.ts web/tailwind.config.ts web/postcss.config.js web/components.json /web/
COPY web/src /web/src
RUN npm run build

FROM python:3.13-alpine
WORKDIR /app
COPY server.py gitea.py records.py work.py a2a_peer.py /app/
RUN addgroup -S forum \
    && adduser -S -G forum forum \
    && mkdir -p /data \
    && chown forum:forum /data
COPY --from=web --chown=forum:forum /web/dist /app/web/dist
USER forum
EXPOSE 3001
CMD ["python", "-u", "server.py"]
