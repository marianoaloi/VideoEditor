/**
 * Settings workspace: every key of the Settings schema, edited as a draft and saved with one
 * deep-partial patch (`settings:update`). Main validates again; its VALIDATION error reaches the
 * operator as a notification and nothing is saved.
 */
import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'
import { useAppDispatch, useAppSelector } from '@renderer/app/hooks'
import { useKeymap } from '@renderer/app/keymap/useKeymap'
import { useNotify } from '@renderer/app/notifications/notify'
import type { ToolsStatus } from '@shared/domain/job'
import type { CommandTemplate, HookName } from '@shared/domain/hooks'
import { SettingsSchema, type Settings, type SettingsSection } from '@shared/domain/settings'
import { loadTools } from '../jobs/jobsSlice'
import ConfirmDialog from './ConfirmDialog'
import FieldControl from './FieldControl'
import { buildPatch, getIn, SECTIONS, setIn, type FieldDef } from './fields'
import HooksEditor from './HooksEditor'
import { loadSettings, resetSettings, updateSettings } from './settingsSlice'

type TabId = SettingsSection

const TABS: readonly { id: TabId; title: string }[] = [
  ...SECTIONS.map(({ id, title }) => ({ id, title })),
  { id: 'hooks', title: 'Hooks' }
]

function validationMessages(draft: Settings): string[] {
  const result = SettingsSchema.safeParse(draft)
  if (result.success) return []
  return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

function ToolsPanel({
  tools,
  onPickEncoder,
  onRefresh
}: {
  tools: ToolsStatus | null
  onPickEncoder: (encoder: string) => void
  onRefresh: () => void
}) {
  return (
    <Alert
      severity={tools?.ffmpeg ? 'info' : 'warning'}
      action={<Button onClick={onRefresh}>Detect again</Button>}
      sx={{ mb: 2 }}
    >
      <Typography variant="body2">
        ffmpeg: {tools?.ffmpeg ? `${tools.ffmpeg.path} (${tools.ffmpeg.version ?? 'unknown version'})` : 'not found'}
      </Typography>
      <Typography variant="body2">
        ffprobe: {tools?.ffprobe ? `${tools.ffprobe.path} (${tools.ffprobe.version ?? 'unknown version'})` : 'not found'}
      </Typography>
      {tools?.error ? <Typography variant="body2">{tools.error.message}</Typography> : null}
      {tools && tools.h264Encoders.length > 0 ? (
        <Box sx={{ mt: 0.5 }}>
          <Typography variant="caption">H.264 encoders (click to add to the chain): </Typography>
          {tools.h264Encoders.map((encoder) => (
            <Chip
              key={encoder}
              label={encoder}
              onClick={() => onPickEncoder(encoder)}
              sx={{ mr: 0.5 }}
            />
          ))}
        </Box>
      ) : null}
      {tools && tools.hwaccels.length > 0 ? (
        <Typography variant="caption" component="p">
          Hardware acceleration: {tools.hwaccels.join(', ')}
        </Typography>
      ) : null}
    </Alert>
  )
}

function SectionForm({
  fields,
  settings,
  onChange
}: {
  fields: readonly FieldDef[]
  settings: Settings
  onChange: (path: readonly string[], value: unknown) => void
}) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' , marginTop: 1}}>
      {fields.map((def) => (
        <FieldControl
          key={def.path.join('.')}
          def={def}
          value={getIn(settings, def.path)}
          onChange={(value) => onChange(def.path, value)}
        />
      ))}
    </Box>
  )
}

export default function SettingsScreen() {
  const dispatch = useAppDispatch()
  const toast = useNotify()
  const stored = useAppSelector((state) => state.settings.value)
  const status = useAppSelector((state) => state.settings.status)
  const saving = useAppSelector((state) => state.settings.saving)
  const tools = useAppSelector((state) => state.jobs.tools)
  const [tab, setTab] = useState<TabId>('folders')
  const [edits, setEdits] = useState<Settings | null>(null)
  /** Bumped by Revert / Reset so text fields that keep local text re-initialise. */
  const [revision, setRevision] = useState(0)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    if (stored === null && status !== 'loading') void dispatch(loadSettings())
    void dispatch(loadTools(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, [dispatch])

  const current = edits ?? stored
  const dirty = edits !== null && stored !== null && JSON.stringify(edits) !== JSON.stringify(stored)
  const problems = useMemo(() => (current === null ? [] : validationMessages(current)), [current])

  const edit = (change: (base: Settings) => Settings): void => {
    if (current === null) return
    setEdits(change(current))
  }
  const save = (): void => {
    if (stored === null || edits === null || !dirty || problems.length > 0 || saving) return
    void dispatch(updateSettings(buildPatch(stored, edits)))
      .unwrap()
      .then(() => {
        setEdits(null)
        setRevision((n) => n + 1)
        toast.success('Settings saved')
      })
      .catch(() => undefined) // initApp already reported the rejected thunk
  }
  const revert = (): void => {
    setEdits(null)
    setRevision((n) => n + 1)
  }
  const resetTab = (): void => {
    setConfirmReset(false)
    void dispatch(resetSettings(tab))
      .unwrap()
      .then(revert)
      .catch(() => undefined) // reported by initApp
  }

  useKeymap('settings', [
    {
      id: 'settings.save',
      keys: ['Ctrl+S'],
      description: 'Save the settings',
      allowInInput: true,
      enabled: dirty && problems.length === 0,
      run: save
    }
  ])

  const section = SECTIONS.find((s) => s.id === tab)

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      <Typography variant="h6" component="h1">
        Settings
      </Typography>
      {current === null ? (
        <Alert severity={status === 'error' ? 'error' : 'info'} sx={{ mt: 2 }}>
          {status === 'error' ? 'The settings could not be loaded.' : 'Loading settings...'}
        </Alert>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={(_e, value: TabId) => setTab(value)}
            variant="scrollable"
            aria-label="Settings sections"
            sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
          >
            {TABS.map(({ id, title }) => (
              <Tab key={id} value={id} label={title} />
            ))}
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: 1 }} key={`${tab}-${String(revision)}`}>
            {section === undefined ? (
              <HooksEditor
                hooks={current.hooks}
                onError={(error, context) => toast.apiError(error, context)}
                onChange={(name: HookName, template: CommandTemplate) =>
                  edit((base) => setIn(base, ['hooks', name], template))
                }
              />
            ) : (
              <>
                {tab === 'ffmpeg' ? (
                  <ToolsPanel
                    tools={tools}
                    onRefresh={() => void dispatch(loadTools(true))}
                    onPickEncoder={(encoder) =>
                      edit((base) =>
                        base.ffmpeg.encoders.includes(encoder)
                          ? base
                          : setIn(base, ['ffmpeg', 'encoders'], [...base.ffmpeg.encoders, encoder])
                      )
                    }
                  />
                ) : null}
                <SectionForm
                  fields={section.fields}
                  settings={current}
                  onChange={(path, value) => edit((base) => setIn(base, path, value))}
                />
              </>
            )}
          </Box>
          {problems.length > 0 ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {problems.slice(0, 3).join('; ')}
              {problems.length > 3 ? ` (+${String(problems.length - 3)} more)` : ''}
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
            <Button
              variant="contained"
              onClick={save}
              disabled={!dirty || problems.length > 0 || saving}
              title="Ctrl+S"
            >
              Save
            </Button>
            <Button onClick={revert} disabled={!dirty}>
              Revert
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button color="warning" onClick={() => setConfirmReset(true)}>
              Reset {TABS.find((t) => t.id === tab)?.title} to defaults
            </Button>
          </Stack>
          <ConfirmDialog
            open={confirmReset}
            title="Reset to defaults"
            message={`Restore the default values of "${TABS.find((t) => t.id === tab)?.title ?? tab}"? Unsaved edits in this screen are discarded.`}
            confirmLabel="Reset"
            onConfirm={resetTab}
            onCancel={() => setConfirmReset(false)}
          />
        </>
      )}
    </Box>
  )
}
