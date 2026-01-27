# SSL Setup Instructions - Optimized for Gaming Performance

## Performance-Optimized Architecture

This setup uses SSL strategically:
- **HTTPS only**: For browser security and initial connection
- **WebRTC/UDP**: For actual game data (low latency)
- **HTTP proxy**: Backend communication without SSL overhead

## Environment-Based Configuration

The application reads server configuration from the `.env` file:

```env
VITE_SERVER_URL=https://13.127.217.1
VITE_SERVER_PORT=3000
```

## Performance Benefits

- **Browser Security**: HTTPS satisfies mixed-content requirements
- **Low Latency**: WebRTC uses UDP-like transport for game data
- **No SSL Overhead**: Backend communication bypasses SSL encryption
- **Optimized Timeouts**: 1-second timeouts for real-time responsiveness

## Self-Signed Certificate (Development)

The Dockerfile automatically generates a self-signed certificate for development. 
To use it:

1. Build the Docker image:
```bash
docker build -t slingshot-client .
```

2. Run the container:
```bash
docker run -p 80:80 -p 443:443 slingshot-client
```

3. Access the application at:
   - HTTP: http://localhost (redirects to HTTPS)
   - HTTPS: https://localhost

4. Accept the browser security warning for the self-signed certificate.

## Custom Server Configuration

To use a different server, update the `.env` file before building:

```env
VITE_SERVER_URL=https://your-server.com
VITE_SERVER_PORT=3000
```

Then rebuild the Docker image:
```bash
docker build -t slingshot-client .
docker run -p 80:80 -p 443:443 slingshot-client
```

## Production SSL Certificate

For production, replace the self-signed certificate with a proper SSL certificate:

1. Obtain SSL certificates (cert.pem and key.pem)
2. Mount them to the container:
```bash
docker run -p 80:80 -p 443:443 \
  -v /path/to/your/cert.pem:/etc/nginx/ssl/cert.pem \
  -v /path/to/your/key.pem:/etc/nginx/ssl/key.pem \
  slingshot-client
```

## Runtime Environment Override

You can also override the backend server at runtime:

```bash
docker run -p 80:80 -p 443:443 \
  -e BACKEND_SERVER="your-server.com:3000" \
  slingshot-client
```

## Performance Monitoring

The optimized configuration includes:
- **Proxy buffering disabled**: Reduces latency
- **1-second timeouts**: Fast failure detection
- **WebRTC data channels**: UDP-like performance
- **HTTP backend**: No SSL encryption overhead

This setup provides browser compatibility while maintaining optimal gaming performance.
