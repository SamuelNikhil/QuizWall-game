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
ARG VITE_USE_PROXY=true
ENV VITE_SERVER_URL=${VITE_SERVER_URL:-http://13.127.217.1}
ENV VITE_SERVER_PORT=${VITE_SERVER_PORT:-3000}
ENV VITE_USE_PROXY=${VITE_USE_PROXY}

# Build the application
RUN npm run build

# Production stage - Lightweight Express Proxy
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies
RUN npm install express http-proxy-middleware

# Copy built application and proxy server
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js

# Set environment variables for the runtime proxy
ENV PORT=3000
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV VITE_SERVER_PORT=${VITE_SERVER_PORT}

# Expose port
EXPOSE 3000

# Start custom proxy server
CMD ["node", "server.js"]
