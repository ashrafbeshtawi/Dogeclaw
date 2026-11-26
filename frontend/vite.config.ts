import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// Builds the three pages straight into the folder Express serves under
// /static (see agent/src/web/server.js). Asset names carry no hash so a
// rebuild only changes the files whose content changed.
export default defineConfig({
  base: '/static/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': src(''),
      // Rare UI components are written for Next.js; these stand in for the
      // two Next modules they import.
      'next/link': src('shims/next-link.tsx'),
      'next/navigation': src('shims/next-navigation.ts'),
    },
  },
  build: {
    outDir: '../agent/src/web/public',
    emptyOutDir: true,
    rollupOptions: {
      input: ['index.html', 'login.html', 'admin.html'],
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        advancedChunks: { groups: [{ name: 'vendor', test: /node_modules/ }] },
        assetFileNames: (asset) => (asset.names[0]?.endsWith('.css') ? 'assets/app.css' : 'assets/[name][extname]'),
      },
    },
  },
});
