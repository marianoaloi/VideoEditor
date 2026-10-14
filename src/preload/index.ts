import { contextBridge } from 'electron'
import { createBridge } from './bridge'

// The preload runs sandboxed: it is bundled into one CJS file and may only import 'electron'
// (plus pure code from src/shared). No node:* imports here.

contextBridge.exposeInMainWorld('api', createBridge())
