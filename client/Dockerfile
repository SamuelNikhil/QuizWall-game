# syntax=docker/dockerfile:1

# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build-time configuration for the game server endpoint
ARG VITE_SERVER_URL
ARG VITE_SERVER_PORT
ENV VITE_SERVER_URL=${VITE_SERVER_URL:-http://13.127.217.1}
ENV VITE_SERVER_PORT=${VITE_SERVER_PORT}

# Build the application
RUN npm run build

# Production stage
FROM nginx:1.27-alpine

# Copy built application
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration from client directory
COPY --from=build /app/nginx.conf /etc/nginx/nginx.conf

# Expose HTTP and HTTPS ports
EXPOSE 80 443

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
