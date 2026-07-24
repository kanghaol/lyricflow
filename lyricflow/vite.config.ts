import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import fs from 'node:fs';
import path from 'node:path';

// Load manifest.json safely without parser errors
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'manifest.json'), 'utf-8')
);
export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
})