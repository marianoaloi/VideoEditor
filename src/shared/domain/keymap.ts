/**
 * Central keybinding registry data (F18, LEG §3.3 HelpComponent, without its shared-class bug).
 * Owner (wave 2): ui-shell (registry and `useKeymap` in `renderer/src/app/keymap/`).
 *
 * Canonical chord: modifiers in the order `Ctrl+Alt+Shift+Meta+`, then one key name.
 * Letters are upper case (`A`), digits `0`-`9`, `F1`-`F12`, `ArrowUp|ArrowDown|ArrowLeft|ArrowRight`,
 * `Home End PageUp PageDown Insert Delete Backspace Enter Escape Space Tab`, and the symbol keys
 * `Plus Minus Multiply Divide Period Comma` (Shift is not part of a symbol key's chord).
 */
import { z } from 'zod';

const KEY = String.raw`(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Enter|Escape|Space|Tab|Plus|Minus|Multiply|Divide|Period|Comma)`;
export const KEY_CHORD_PATTERN = new RegExp(String.raw`^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Meta\+)?${KEY}$`);

export const KeyChordSchema = z.string().regex(KEY_CHORD_PATTERN, 'Not a canonical key chord');
export type KeyChord = z.infer<typeof KeyChordSchema>;

export const WORKSPACE_IDS = [
  'videoTriage',
  'imageTriage',
  'cutter',
  'jobs',
  'duplicates',
  'settings'
] as const;
export const WorkspaceIdSchema = z.enum(WORKSPACE_IDS);
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

/**
 * `global` works everywhere unless a modal scope is open. A workspace scope works only while that
 * workspace is shown. Modal scopes (`crop`, `zoom`, `help`, `dialog`) take all keys while open.
 */
export const MODAL_SCOPES = ['crop', 'zoom', 'help', 'dialog'] as const;
export const KeymapScopeSchema = z.enum(['global', ...WORKSPACE_IDS, ...MODAL_SCOPES]);
export type KeymapScope = z.infer<typeof KeymapScopeSchema>;

export const BindingSchema = z.object({
  /** Unique, `<scope>.<action>`, e.g. `videoTriage.moveLeft`. */
  id: z.string().min(1),
  keys: z.array(KeyChordSchema).min(1),
  /** Shown in the F1 help. */
  description: z.string().min(1),
  scope: KeymapScopeSchema
});
export type Binding = z.infer<typeof BindingSchema>;

/** The same chord bound twice in one scope, or in a workspace scope and `global`. */
export const KeymapConflictSchema = z.object({
  chord: KeyChordSchema,
  scope: KeymapScopeSchema,
  bindingIds: z.array(z.string()).min(2)
});
export type KeymapConflict = z.infer<typeof KeymapConflictSchema>;
