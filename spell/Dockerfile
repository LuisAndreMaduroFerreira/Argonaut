# Build context is the spell folder (see docker-compose.yml).

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && node -e "import('./dist/app.js')"

# What runs: Node, the dictionaries and the compiled code, with Node as the main process.
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node

EXPOSE 8790

CMD ["node", "dist/index.js"]
