# syntax=docker/dockerfile:1

# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy .env file for build-time configuration
COPY .env ./.env

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build-time configuration for the game server endpoint from .env
ARG VITE_SERVER_URL=https://13.127.217.1
ARG VITE_SERVER_PORT=3000
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV VITE_SERVER_PORT=${VITE_SERVER_PORT}

# Build the application
RUN npm run build

# Production stage
FROM nginx:1.27-alpine

# Install OpenSSL for generating certificates
RUN apk add --no-cache openssl

# Create SSL directory
RUN mkdir -p /etc/nginx/ssl

# Generate self-signed SSL certificate
RUN openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/key.pem \
    -out /etc/nginx/ssl/cert.pem \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Copy built application
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration from client directory
COPY --from=build /app/nginx.conf /etc/nginx/nginx.conf

# Expose HTTP and HTTPS ports
EXPOSE 80 443

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
