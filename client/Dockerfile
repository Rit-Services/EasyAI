# JurisAI web client (React/Vite -> static, served by nginx).
# IMPORTANT: build context must be the REPO ROOT, because the client's Vite
# config aliases the screenshot-feedback plugin from ../plugins (outside client/).
#   docker build -f client/Dockerfile -t ritservi/jurisai-client:latest .
FROM node:20-alpine AS build
WORKDIR /app

# Install client deps first (better layer caching).
COPY client/package*.json ./client/
RUN cd client && npm ci

# The plugin source the client imports via a Vite alias, then the client source.
COPY plugins ./plugins
COPY client ./client

RUN cd client && npm run build

# --- Serve the built SPA with nginx, as a non-root user ---
# nginx-unprivileged runs as uid 101 and keeps its pid/temp files in /tmp, so it
# works with a read-only root filesystem. It still listens on port 80: the pod
# sets the net.ipv4.ip_unprivileged_port_start sysctl (see k8s manifests).
FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
USER 101
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
