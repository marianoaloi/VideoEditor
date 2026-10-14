/** Hook channels (ADR-008). Owner (wave 2): svc-files. */
import { defineInvoke, type InvokeMapOf } from '../define';
import {
  HookPreviewRequestSchema,
  HookRunRequestSchema,
  type HookExit,
  type HookOutput,
  type HookPreview,
  type HookRunStarted
} from '../../domain/hooks';

export { HookPreviewRequestSchema, HookRunRequestSchema };

export const hooksInvoke = {
  /**
   * Starts the hook and returns at once (`skipped` when disabled or unconfigured; the built-in
   * part of `deleteR` still runs). Output: `hooks:output`; end: `hooks:exit`.
   */
  'hooks:run': defineInvoke(HookRunRequestSchema).returns<HookRunStarted>(),
  /** Expands a template without running it (Settings preview). VALIDATION on bad placeholders. */
  'hooks:preview': defineInvoke(HookPreviewRequestSchema).returns<HookPreview>()
} as const;

export type HooksInvoke = InvokeMapOf<typeof hooksInvoke>;

export interface HooksEvents {
  'hooks:output': HookOutput;
  'hooks:exit': HookExit;
}
