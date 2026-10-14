import { contextBridge } from 'electron'

// The preload runs sandboxed: it is bundled into one CJS file and may only import 'electron'
// (plus pure code from src/shared). No node:* imports here.

// SWARM-WIRE(bridge): replace the empty object with createBridge() from './bridge'
contextBridge.exposeInMainWorld('api', {})
