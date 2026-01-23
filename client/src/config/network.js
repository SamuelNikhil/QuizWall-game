const DEFAULT_SERVER_PORT = 3000;

const TUNNEL_HOSTS = ['loca.lt', 'ngrok'];

function getProtocol(hostname) {
    return TUNNEL_HOSTS.some((host) => hostname.includes(host)) ? 'https' : 'http';
}

export function getServerConfig() {
    // Use Netlify domain in production, fallback to env or localhost
    const isProduction = import.meta.env.PROD;
    let serverUrl = import.meta.env.VITE_SERVER_URL || (isProduction ? window.location.origin : 'http://localhost:5173');

    if (!serverUrl.startsWith('http')) {
        const protocol = getProtocol(serverUrl);
        serverUrl = `${protocol}://${serverUrl}`;
    }

    const urlObj = new URL(serverUrl);

    const connectionPort = urlObj.port
        ? parseInt(urlObj.port, 10)
        : DEFAULT_SERVER_PORT;

    return { serverUrl, connectionPort };
}
