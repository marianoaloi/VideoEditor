import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import pkg from './package.json'

/**
 * Native packages that are NOT bundled: the main process loads them from node_modules at runtime.
 * Each one must also be listed under `asarUnpack` in electron-builder.yml.
 *
 * Everything else is bundled by Vite, wherever it sits in package.json. That is what lets
 * ESM-only packages (file-type, ...) load in the CommonJS main bundle.
 */
const NATIVE_EXTERNALS = ['sharp']

const bundledDependencies = Object.keys(pkg.dependencies).filter(
  (name) => !NATIVE_EXTERNALS.includes(name)
)

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      externalizeDeps: { include: NATIVE_EXTERNALS, exclude: bundledDependencies }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      // A sandboxed preload can only require('electron'): bundle every dependency into one CJS file.
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', inlineDynamicImports: true } }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react()]
  }
})
