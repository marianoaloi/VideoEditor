/** The single listener middleware instance (kept apart from `store.ts` to avoid import cycles). */
import { createListenerMiddleware } from '@reduxjs/toolkit'

export const listenerMiddleware = createListenerMiddleware()
