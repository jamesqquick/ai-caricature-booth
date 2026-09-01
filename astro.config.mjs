// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [react()],
  output: 'server',
  security: {
    actionBodySizeLimit: 7 * 1024 * 1024,
  },
  session: false,
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['astro/assets/services/noop', 'drizzle-orm', 'drizzle-orm/d1'],
    },
  },
});
