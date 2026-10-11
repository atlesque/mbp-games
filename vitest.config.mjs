import { defineConfig } from 'vitest/config';

// cloudflare:workers only exists in the Workers runtime; test/cf-workers.js stands in for the bits src/ uses
export default defineConfig({
  test: { include: ['test/**/*.test.js'], environment: 'node' },
  resolve: { alias: { 'cloudflare:workers': new URL('./test/cf-workers.js', import.meta.url).pathname } },
});
