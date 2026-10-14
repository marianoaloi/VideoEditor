import type { WorkspaceId } from '@shared/domain/keymap'

export const WORKSPACE_LABELS: Readonly<Record<WorkspaceId, string>> = {
  videoTriage: 'Video Triage',
  imageTriage: 'Image Triage',
  cutter: 'Cutter',
  jobs: 'Jobs',
  duplicates: 'Duplicates',
  settings: 'Settings'
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
