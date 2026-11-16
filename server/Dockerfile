# Build context is the project root (see docker-compose.yml).
#
# The image is built whenever Argonaut starts and the source has changed, so the build is also
# the gate: a type error or a failing unit test stops it, and the version that was running stays.

# The web app: tested, type-checked and bundled.
FROM node:24-slim AS web
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY shared ./shared
COPY src ./src
RUN npm test && npm run build

# The API: type-checked and compiled to plain JavaScript.
FROM node:24-slim AS api
WORKDIR /repo/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY shared ../shared
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
COPY server/migrations ./migrations
# Loading the compiled app proves it runs as plain JavaScript, before anything is replaced.
RUN npm run build && node -e "import('./dist/server/src/app.js')"

# What runs: Node, the API's own dependencies, the compiled code and the built web app. No
# compiler and no dev tools, and Node itself is the main process, so it hears "stop".
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=api /repo/server/dist ./
COPY --from=web /repo/dist ./server/public
USER node

EXPOSE 8787

CMD ["node", "server/src/index.js"]
