/**
 * Absolute path of the bundled worker script. `?modulePath` is an electron-vite feature: it emits
 * `hashWorker.ts` as its own chunk next to the main bundle (`out/main/chunks/`) and the import
 * resolves to that file's path at runtime. Only load this module lazily (it is not understood by
 * Vitest, which injects its own worker path).
 */
import workerPath from './hashWorker?modulePath'

export default workerPath
