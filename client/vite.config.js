import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/.wrtc': {
        target: 'ttp://13.127.217.1:3000',
        changeOrigin: true,
        secure: false,
        ws: true
      }
    }
  },
  preview: {
    host: true,
    allowedHosts: ['slingshot-game.onrender.com', 'slingshot-client.onrender.com', 'localhost']
  }
})
