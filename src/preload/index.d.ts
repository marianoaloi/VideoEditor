import type { RendererApi } from '@shared/ipc/contract'

declare global {
  interface Window {
    /** Typed bridge exposed by the preload (createBridge). */
    api: RendererApi
  }
}

export {}
