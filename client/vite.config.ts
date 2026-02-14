import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    // Load env file based on `mode` in the current working directory.
    // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
    const env = loadEnv(mode, process.cwd(), '')
    const serverHost = env.VITE_SERVER_URL || 'http://localhost'
    const serverPort = env.VITE_SERVER_PORT || '3000'
    // Strip any existing port from URL, then append the configured port
    const hostOnly = serverHost.replace(/:\d+$/, '')
    const serverUrl = `${hostOnly}:${serverPort}`

    console.log(`[Vite] Proxying /.wrtc to: ${serverUrl}`)

    return {
        plugins: [react()],
        server: {
            host: true,
            proxy: {
                '/.wrtc': {
                    target: serverUrl,
                    changeOrigin: true,
                    secure: false,
                    ws: true
                }
            }
        },
        preview: {
            host: true,
            allowedHosts: ['slingshot-game.onrender.com', 'localhost', 'slingshot-game-test.onrender.com']
        }
    }
})
