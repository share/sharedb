import {defineConfig} from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // Proxy websockets to ws://localhost:8080 for `npm run dev`
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true
      }
    }
  }
});
