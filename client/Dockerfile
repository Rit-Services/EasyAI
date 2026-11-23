# JurisAI web client (React/Vite -> static, served by nginx).
# IMPORTANT: build context must be the REPO ROOT, because the client's Vite
# config aliases the screenshot-feedback plugin from ../plugins and the law
# catalog from ../content (both outside client/).
#   docker build -f client/Dockerfile -t ritservi/jurisai-client:latest .
FROM node:20-alpine AS build
WORKDIR /app

# Install client deps first (better layer caching).
COPY client/package*.json ./client/
RUN cd client && npm ci

# The plugin source and law catalog the client imports via Vite aliases, then
# the client source.
COPY plugins ./plugins
COPY content ./content
COPY client ./client

RUN cd client && npm run build

# --- Serve the built SPA with nginx, as a non-root user ---
# nginx-unprivileged runs as uid 101 and keeps its pid/temp files in /tmp, so it
# works with a read-only root filesystem. It still listens on port 80: the pod
# sets the net.ipv4.ip_unprivileged_port_start sysctl (see k8s manifests).
FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime

# The upstream image lags behind security fixes, both Alpine's and nginx's own, so
# install them here. nginx comes from nginx.org's repository: the image keeps its
# signing key (checked when the image was built) but not the repository, so it is
# added back, tagged, for this upgrade only. The nginx.org modules go first:
# nothing here loads them, and they pull in libraries that keep carrying CVEs.
# curl only comes with the upstream image and nothing here uses it (the probes are
# HTTP), so it goes too. CI always rebuilds this stage (no-cache-filters in
# deploy-k8s.yml) so a cached layer cannot keep old packages.
USER root
RUN echo "@nginxorg https://nginx.org/packages/alpine/v$(cut -d. -f1,2 /etc/alpine-release)/main" >> /etc/apk/repositories \
 && apk del --no-cache nginx-module-geoip nginx-module-image-filter nginx-module-njs nginx-module-xslt curl \
 && apk add --no-cache nginx@nginxorg \
 && apk upgrade --no-cache \
 && sed -i '/@nginxorg/d' /etc/apk/repositories

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
USER 101
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
