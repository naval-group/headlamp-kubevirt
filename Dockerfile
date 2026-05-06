FROM node:24-alpine@sha256:7fddd9ddeae8196abf4a3ef2de34e11f7b1a722119f91f28ddf1e99dcafdf114 AS builder

WORKDIR /plugin

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Init-container image: started by Headlamp's Pod and copies the plugin files
# into a shared emptyDir at /headlamp/plugins/.
FROM busybox:latest@sha256:1487d0af5f52b4ba31c7e465126ee2123fe3f2305d638e7827681e7cf6c83d5e AS busybox

COPY --from=builder /plugin/dist /plugins/kubevirt/
COPY --from=builder /plugin/package.json /plugins/kubevirt/

LABEL org.opencontainers.image.source=https://github.com/naval-group/headlamp-kubevirt
LABEL org.opencontainers.image.licenses=Apache-2.0
LABEL org.opencontainers.image.description="Headlamp KubeVirt plugin (init-container image for Headlamp in-cluster install)"

USER 1001

CMD ["sh", "-c", "echo Plugins installed at /plugins/; ls /plugins/"]

# File-only image for the Kubernetes image volume source.
# https://kubernetes.io/docs/concepts/storage/volumes/#image
# The plugin's main.js and package.json sit at the image root; mount the
# volume at the desired plugin sub-directory (e.g. /headlamp/plugins/kubevirt).
FROM scratch AS oci

COPY --from=builder /plugin/dist/main.js /main.js
COPY --from=builder /plugin/package.json /package.json

LABEL org.opencontainers.image.source=https://github.com/naval-group/headlamp-kubevirt
LABEL org.opencontainers.image.licenses=Apache-2.0
LABEL org.opencontainers.image.description="Headlamp KubeVirt plugin (file-only image for Kubernetes image volume)"
