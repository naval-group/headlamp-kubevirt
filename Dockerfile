FROM node:22-alpine AS builder

WORKDIR /plugin

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM busybox:latest

COPY --from=builder /plugin/dist /plugins/headlamp-kubevirt/
COPY --from=builder /plugin/package.json /plugins/headlamp-kubevirt/

LABEL org.opencontainers.image.source=https://github.com/naval-group/headlamp-kubevirt
LABEL org.opencontainers.image.licenses=Apache-2.0

USER 1001

CMD ["sh", "-c", "echo Plugins installed at /plugins/; ls /plugins/"]
