# ── build ──
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web/package*.json web/
RUN cd web && npm ci
COPY . .
RUN npm run build

# ── produção ──
FROM node:22-bookworm-slim
ENV NODE_ENV=production
# ffmpeg converte os áudios do vendedor para o formato de mensagem de voz do WhatsApp
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY seed ./seed
# O banco fica em /app/data: monte um volume persistente nesse caminho (no Railway: Volumes)
ENV DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
