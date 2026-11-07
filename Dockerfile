FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY agent ./agent
COPY src ./src
COPY fixtures ./fixtures
RUN mkdir -p out && chown node:node out
EXPOSE 3000
USER node
CMD ["npx", "tsx", "src/server/index.ts"]
