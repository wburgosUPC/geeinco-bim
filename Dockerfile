FROM node:22-bookworm-slim
WORKDIR /app
COPY dist ./dist
COPY server-vendor ./server-vendor
COPY *.cjs *.mjs ./
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "server.cjs"]
