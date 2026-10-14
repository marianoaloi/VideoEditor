declare global {
  interface Window {
    /** Typed bridge exposed by the preload. Retyped when the bridge is wired (SWARM-WIRE(bridge)). */
    api: unknown
  }
}

export {}
