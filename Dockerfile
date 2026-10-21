FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY tests ./tests
COPY public ./public
RUN npm test
RUN npm prune --omit=dev
FROM node:24-bookworm-slim
# Patch the OS finding from the real CI scan. npm is build tooling only;
# this runtime starts node directly and must not ship npm's vulnerable tree.
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade perl-base \
    && apt-get clean \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public
USER node
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
