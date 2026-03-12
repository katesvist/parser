FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* nest-cli.json tsconfig.json tsconfig.build.json ./
COPY apps ./apps
COPY libs ./libs
COPY config ./config

RUN npm ci
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache libreoffice ttf-freefont p7zip libarchive-tools

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY config ./config
COPY tools ./tools

CMD ["node", "dist/apps/worker-ingest/main.js"]
