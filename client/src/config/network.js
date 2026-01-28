/**
 * Network Configuration for Geckos.io WebRTC Signaling
 * 
 * Supports two connection modes:
 * 1. DIRECT: Client connects directly to the game server (lower latency)
 * 2. PROXY: Client connects via hosting proxy like Render/Hostinger (fallback)
 * 
 * Environment Variables:
 * - VITE_SERVER_URL: The game server URL (required)
 * - VITE_SERVER_PORT: The game server port (default: 3000)
 * - VITE_USE_PROXY: Set to 'true' to use hosting-side proxy instead of direct connection
 * - VITE_SIGNALING_PATH: Custom signaling path (default: '/.wrtc' for proxy, '' for direct)
 */

const DEFAULT_SERVER_PORT = 3000;
const DEFAULT_SIGNALING_PATH = '/.wrtc';

function getProtocol(hostname) {
    return hostname.includes('localhost') ? 'http' : 'https';
}

export function getServerConfig() {
    const isProduction = import.meta.env.PROD;
    const useProxy = import.meta.env.VITE_USE_PROXY === 'true';

    let serverUrl = import.meta.env.VITE_SERVER_URL;
    const serverPort = import.meta.env.VITE_SERVER_PORT || DEFAULT_SERVER_PORT;

    if (!serverUrl) {
        throw new Error('Server not configured: VITE_SERVER_URL environment variable is required');
    }

    // Auto-detect protocol based on hostname
    if (!serverUrl.startsWith('http')) {
        const protocol = getProtocol(serverUrl);
        serverUrl = `${protocol}://${serverUrl}`;
    }

    // Append port if not already present
    if (!serverUrl.match(/:\d+/) && serverPort) {
        serverUrl = `${serverUrl}:${serverPort}`;
    }

    const urlObj = new URL(serverUrl);
    const connectionPort = parseInt(urlObj.port, 10) || DEFAULT_SERVER_PORT;

    // Determine connection strategy
    let geckosUrl, geckosPort, geckosPath;

    if (useProxy) {
        // PROXY MODE: Connect through the hosting platform's proxy
        // Client connects to its own origin, proxy forwards to game server
        geckosUrl = window.location.origin;
        geckosPort = window.location.protocol === 'https:' ? 443 : 80;
        geckosPath = import.meta.env.VITE_SIGNALING_PATH || DEFAULT_SIGNALING_PATH;
    } else {
        // DIRECT MODE: Connect directly to the game server (faster!)
        // No proxy hop = lower latency for signaling
        geckosUrl = `${urlObj.protocol}//${urlObj.hostname}`;
        geckosPort = connectionPort;
        geckosPath = import.meta.env.VITE_SIGNALING_PATH || '';
    }

    console.log('[Network Config]', {
        mode: useProxy ? 'PROXY' : 'DIRECT',
        geckosUrl,
        geckosPort,
        geckosPath,
        serverUrl,
        isProduction
    });

    return {
        serverUrl,
        connectionPort,
        // Geckos.io specific config
        geckosUrl,
        geckosPort,
        geckosPath,
        useProxy
    };
}
