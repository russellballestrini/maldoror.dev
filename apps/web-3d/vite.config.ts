import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use remote server for API if local isn't available
const API_TARGET = process.env.API_TARGET || 'http://134.199.180.251:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/files': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/ws': {
        target: API_TARGET.replace('http', 'ws'),
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
