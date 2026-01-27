const DEFAULT_SERVER_PORT = 3000;

function getProtocol(hostname) {
    // Use HTTPS for production to satisfy browser security
    // WebRTC will handle the actual game data transport
    return import.meta.env.PROD ? 'https' : 'http';
}

export function getServerConfig() {
    // Use Netlify domain in production, fallback to env or throw error
    const isProduction = import.meta.env.PROD;
    let serverUrl = import.meta.env.VITE_SERVER_URL;
    
    if (!serverUrl) {
        throw new Error('Server not configured: VITE_SERVER_URL environment variable is required');
    }

    // Ensure serverUrl includes port if specified in VITE_SERVER_PORT
    const serverPort = import.meta.env.VITE_SERVER_PORT;
    if (serverPort && !serverUrl.includes(`:${serverPort}`)) {
        // Remove existing port if present
        const urlWithoutPort = serverUrl.replace(/:\d+/, '');
        serverUrl = `${urlWithoutPort}:${serverPort}`;
    }

    // Force HTTPS for production/WebRTC compatibility (browser requirement)
    if (isProduction && serverUrl.startsWith('http://')) {
        serverUrl = serverUrl.replace('http://', 'https://');
    }

    if (!serverUrl.startsWith('http')) {
        const protocol = getProtocol(serverUrl);
        serverUrl = `${protocol}://${serverUrl}`;
    }

    const urlObj = new URL(serverUrl);

    const connectionPort = urlObj.port
        ? parseInt(urlObj.port, 10)
        : DEFAULT_SERVER_PORT;

    console.log('[DEBUG] getServerConfig result:', { 
        serverUrl, 
        connectionPort, 
        isProduction, 
        envUrl: import.meta.env.VITE_SERVER_URL, 
        envPort: import.meta.env.VITE_SERVER_PORT,
        note: 'SSL for browser security, WebRTC for game data performance'
    });

    return { serverUrl, connectionPort };
}
