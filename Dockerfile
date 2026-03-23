FROM node:25-alpine@sha256:5209bcaca9836eb3448b650396213dbe9d9a34d31840c2ae1f206cb2986a8543 AS builder

WORKDIR /plugin

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM busybox:latest@sha256:b3255e7dfbcd10cb367af0d409747d511aeb66dfac98cf30e97e87e4207dd76f

COPY --from=builder /plugin/dist /plugins/headlamp-kubevirt/
COPY --from=builder /plugin/package.json /plugins/headlamp-kubevirt/

LABEL org.opencontainers.image.source=https://github.com/naval-group/headlamp-kubevirt
LABEL org.opencontainers.image.licenses=Apache-2.0

USER 1001

CMD ["sh", "-c", "echo Plugins installed at /plugins/; ls /plugins/"]
