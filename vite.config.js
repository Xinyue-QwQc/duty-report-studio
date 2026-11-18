import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'duty-local-shared',
    apply: 'serve',
    async configureServer(server) {
      const { localShared } = await import('./scripts/local-shared.mjs');
      server.middlewares.use(localShared());
    },
  }],
});
