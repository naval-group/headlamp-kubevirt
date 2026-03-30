FROM node:25-alpine@sha256:cf38e1f3c28ac9d81cdc0c51d8220320b3b618780e44ef96a39f76f7dbfef023 AS builder

WORKDIR /plugin

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM busybox:latest@sha256:b3255e7dfbcd10cb367af0d409747d511aeb66dfac98cf30e97e87e4207dd76f

COPY --from=builder /plugin/dist /plugins/kubevirt/
COPY --from=builder /plugin/package.json /plugins/kubevirt/

LABEL org.opencontainers.image.source=https://github.com/naval-group/headlamp-kubevirt
LABEL org.opencontainers.image.licenses=Apache-2.0

USER 1001

CMD ["sh", "-c", "echo Plugins installed at /plugins/; ls /plugins/"]
