# App da prova. O juiz cria containers irmãos (gcc:13) pelo socket do Docker do host.
FROM node:22-bookworm-slim

# Só o binário do cliente docker; o daemon é o do host.
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DOCKER_CONFIG=/tmp/.docker
USER node
EXPOSE 3000
CMD ["node", "server.js"]
