FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY tests ./tests
COPY public ./public
# Build-time CLI guard fixtures only; these are not copied into the runtime stage.
COPY scripts/client.mjs scripts/dev-tokens.mjs scripts/fixtures.mjs scripts/verify-lineage.mjs ./scripts/
RUN npm test
RUN npm prune --omit=dev
FROM node:24-bookworm-slim
# Runtime starts node directly; npm is needed only in the build stage.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node public ./public
USER node
EXPOSE 8080
CMD ["node", "dist/src/main.js"]
