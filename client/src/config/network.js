const DEFAULT_SERVER_PORT = 3000;

const TUNNEL_HOSTS = ['loca.lt', 'ngrok'];

function getProtocol(hostname) {
    return TUNNEL_HOSTS.some((host) => hostname.includes(host)) ? 'https' : 'http';
}

export function getServerConfig() {
    // Use Netlify domain in production, fallback to env or localhost
    const isProduction = import.meta.env.PROD;
    let serverUrl = import.meta.env.VITE_SERVER_URL || (isProduction ? window.location.origin : 'http://localhost:5173');

    // Ensure serverUrl includes port if specified in VITE_SERVER_PORT
    const serverPort = import.meta.env.VITE_SERVER_PORT;
    if (serverPort && !serverUrl.includes(`:${serverPort}`)) {
        // Remove existing port if present
        const urlWithoutPort = serverUrl.replace(/:\d+/, '');
        serverUrl = `${urlWithoutPort}:${serverPort}`;
    }

    if (!serverUrl.startsWith('http')) {
        const protocol = getProtocol(serverUrl);
        serverUrl = `${protocol}://${serverUrl}`;
    }

    const urlObj = new URL(serverUrl);

    const connectionPort = urlObj.port
        ? parseInt(urlObj.port, 10)
        : DEFAULT_SERVER_PORT;

    console.log('[DEBUG] getServerConfig result:', { serverUrl, connectionPort, isProduction, envUrl: import.meta.env.VITE_SERVER_URL, envPort: import.meta.env.VITE_SERVER_PORT });

    return { serverUrl, connectionPort };
}
