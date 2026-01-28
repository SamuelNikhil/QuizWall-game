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
ARG VITE_USE_PROXY=false
ENV VITE_SERVER_URL=${VITE_SERVER_URL:-http://13.127.217.1}
ENV VITE_SERVER_PORT=${VITE_SERVER_PORT:-3000}
ENV VITE_USE_PROXY=${VITE_USE_PROXY}

# Build the application
RUN npm run build

# Production stage - lightweight static server
FROM node:20-alpine AS production

WORKDIR /app

# Install serve for static file hosting
RUN npm install -g serve@14

# Copy built application
COPY --from=build /app/dist ./dist

# Expose port
EXPOSE 3000

# Start static server with SPA fallback
CMD ["serve", "-s", "dist", "-l", "3000"]
