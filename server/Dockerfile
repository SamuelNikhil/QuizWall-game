    # Use a lightweight Node.js image
    FROM node:20-alpine

    # Set working directory
    WORKDIR /app

    # Copy package files first for better caching
    COPY package.json package-lock.json ./

    # Install dependencies with proper permissions
    RUN npm ci && \
        chmod -R 755 /app/node_modules/.bin

    # Copy the rest of the application code
    COPY . .

    # Expose HTTP signaling port + WebRTC UDP port range
    EXPOSE 3000
    EXPOSE 9000-9100/udp

    # Start the application using the existing start script (tsx)
    CMD ["npm", "start"]
