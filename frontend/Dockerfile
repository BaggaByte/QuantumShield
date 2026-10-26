# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install dependencies (clean install)
RUN npm ci

# Copy frontend source code
COPY . .

# Optional build arguments for remote deployment targets (e.g. Render, Vercel, Docker)
ARG VITE_BACKEND_URL
ARG VITE_WS_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL \
    VITE_WS_URL=$VITE_WS_URL

# Build production bundle
RUN npm run build

# --- Production Stage ---
FROM nginx:alpine

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
