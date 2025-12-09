import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      allowedHosts: [env.APP_DOMAIN, 'localhost', '127.0.0.1'].filter(Boolean),
      proxy: {
        '/api': {
          target: 'http://backend:8000',
          changeOrigin: true
        },
        '/uploads': {
          target: 'http://backend:8000',
          changeOrigin: true
        },
        '/ws': {
          target: 'ws://backend:8000',
          ws: true,
          changeOrigin: true
        }
      }
    }
  }
})
