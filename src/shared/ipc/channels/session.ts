/**
 * Session channels (F1). Owner (wave 2): svc-files.
 * Runtime names: `session.names.ts` (keep both files in sync; the compiler checks it).
 */
import { defineInvoke, type InvokeMapOf } from '../define';
import {
  OpenFolderRequestSchema,
  SessionRefSchema,
  type ScanProgress,
  type Session
} from '../../domain/session';

export { OpenFolderRequestSchema, SessionRefSchema };

export const sessionInvoke = {
  /** Scan a folder (recursive optional), sort, register the root in the media allowlist. */
  'session:open': defineInvoke(OpenFolderRequestSchema).returns<Session>(),
  /** Re-scan the same root with the same options ("Restart", after duplicates moved files). */
  'session:rescan': defineInvoke(SessionRefSchema).returns<Session>(),
  /** Forget the session and remove its root from the allowlist (unless another session uses it). */
  'session:close': defineInvoke(SessionRefSchema).returns<void>()
} as const;

export type SessionInvoke = InvokeMapOf<typeof sessionInvoke>;

export interface SessionEvents {
  'session:scanProgress': ScanProgress;
}
