/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

const bunModulesDir = fileURLToPath(
  new URL('../node_modules/.bun/node_modules', import.meta.url),
);
const bunAliases: Record<string, string> = {};
for (const pkg of ['@zappar/msdf-generator', 'lucide', 'preact']) {
  const target = path.join(bunModulesDir, pkg);
  if (existsSync(target)) {
    bunAliases[pkg] = target;
  }
}

export default defineConfig(({ command }) => ({
  plugins: [iwsdkDev()],
  server: { host: '0.0.0.0', port: 3000, open: false, allowedHosts: true, hmr: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
    },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    alias: bunAliases,
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    noDiscovery: true,
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      'three/examples/jsm/controls/OrbitControls.js',
      'three/examples/jsm/environments/RoomEnvironment.js',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: command === 'build' ? './' : '/',
}));
