# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build-time configuration for the game server endpoint
ARG VITE_SERVER_URL
ARG VITE_SERVER_PORT
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV VITE_SERVER_PORT=${VITE_SERVER_PORT}

RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
