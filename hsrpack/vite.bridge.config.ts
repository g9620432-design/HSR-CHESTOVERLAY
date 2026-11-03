import { resolve } from 'node:path'
import { defineConfig } from 'vite'
const STUBS = process.env.HSRPACK_STUBS
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      { find: /^lib\/interactions\/message$/, replacement: resolve(STUBS, 'message.ts') },
      { find: /^react\/jsx-runtime$/, replacement: resolve(STUBS, 'jsx-runtime.ts') },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(STUBS, 'jsx-runtime.ts') },
    ],
  },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true, outDir: process.env.HSRPACK_OUT || '.bridge-build', emptyOutDir: true, target: 'node20', minify: !!process.env.HSRPACK_MINIFY, sourcemap: false,
    copyPublicDir: false,
    rollupOptions: { input: { engine: resolve(import.meta.dirname, 'src/hsrbridge/bridge.ts') }, output: { entryFileNames: '[name].mjs', inlineDynamicImports: true } },
  },
})
