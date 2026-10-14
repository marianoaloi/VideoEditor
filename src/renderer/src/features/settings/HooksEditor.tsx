/** Hooks table (ADR-008): enable, command, args, cwd, env and a "Test" button per hook. */
import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { call } from '@renderer/app/api'
import {
  HOOK_META,
  HOOK_NAMES,
  HOOK_PLACEHOLDERS,
  type CommandTemplate,
  type HookName,
  type HookPreview
} from '@shared/domain/hooks'
import type { Settings } from '@shared/domain/settings'
import { browsePath } from './browse'
import {
  argsToText,
  envToText,
  isBatchScript,
  sampleContext,
  textToArgs,
  textToEnv
} from './hooksForm'

interface Props {
  hooks: Settings['hooks']
  onChange: (name: HookName, template: CommandTemplate) => void
  onError: (error: unknown, context: string) => void
}

type TestState = { preview: HookPreview } | { error: string } | null

function HookRow({
  name,
  template,
  onChange,
  onError
}: {
  name: HookName
  template: CommandTemplate
  onChange: (template: CommandTemplate) => void
  onError: (error: unknown, context: string) => void
}) {
  const meta = HOOK_META[name]
  const [test, setTest] = useState<TestState>(null)
  const [argsText, setArgsText] = useState(argsToText(template.args))
  const [envText, setEnvText] = useState(envToText(template.env))

  const patch = (change: Partial<CommandTemplate>): void => {
    setTest(null)
    onChange({ ...template, ...change })
  }
  const runTest = (): void => {
    call('hooks:preview', { template, context: sampleContext(name) })
      .then((preview) => setTest({ preview }))
      .catch((error: unknown) =>
        setTest({ error: error instanceof Error ? error.message : String(error) })
      )
  }
  const browse = (): void => {
    browsePath('file', `${meta.label}: program`)
      .then((path) => {
        if (path !== null) patch({ command: path })
      })
      .catch((error: unknown) => onError(error, 'Choosing the program'))
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} component="section" aria-label={meta.label}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
        <FormControlLabel
          label={<Typography variant="subtitle2">{meta.label}</Typography>}
          control={
            <Switch
              checked={template.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
              slotProps={{ input: { 'aria-label': `Enable ${meta.label}` } }}
            />
          }
        />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {meta.trigger}. Placeholders: {meta.provides.join(' ')}
        </Typography>
        <Button variant="outlined" onClick={runTest} aria-label={`Test ${meta.label}`}>
          Test
        </Button>
      </Stack>
      {meta.builtIn === undefined ? null : (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          {meta.builtIn}
        </Typography>
      )}
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', gridColumn: '1 / -1' }}>
          <TextField
            label="Command"
            value={template.command}
            onChange={(e) => patch({ command: e.target.value })}
            error={isBatchScript(template.command)}
            helperText={
              isBatchScript(template.command)
                ? '.cmd and .bat files cannot be started directly; point at an .exe or a wrapper.'
                : undefined
            }
            sx={{ flex: 1 }}
          />
          <Button variant="outlined" onClick={browse} aria-label={`Browse program for ${meta.label}`}>
            Browse
          </Button>
        </Stack>
        <TextField
          label="Arguments (one per line)"
          multiline
          minRows={2}
          value={argsText}
          onChange={(e) => {
            setArgsText(e.target.value)
            patch({ args: textToArgs(e.target.value) })
          }}
        />
        <TextField
          label="Environment (KEY=value per line)"
          multiline
          minRows={2}
          value={envText}
          onChange={(e) => {
            setEnvText(e.target.value)
            const env = textToEnv(e.target.value)
            const { env: _previous, ...rest } = template
            setTest(null)
            onChange(env === undefined ? rest : { ...rest, env })
          }}
        />
        <TextField
          label="Working directory"
          value={template.cwd ?? ''}
          onChange={(e) => {
            const { cwd: _previous, ...rest } = template
            setTest(null)
            onChange(e.target.value === '' ? rest : { ...rest, cwd: e.target.value })
          }}
        />
      </Box>
      {test === null ? null : 'error' in test ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {test.error}
        </Alert>
      ) : (
        <Alert severity="success" sx={{ mt: 1 }} icon={false}>
          <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {[
              `command: ${test.preview.command}`,
              ...test.preview.args.map((arg, i) => `arg ${String(i + 1)}: ${arg}`),
              `cwd: ${test.preview.cwd ?? '(none)'}`,
              ...Object.entries(test.preview.env).map(([k, v]) => `env ${k}=${v}`)
            ].join('\n')}
          </Box>
        </Alert>
      )}
    </Paper>
  )
}

export default function HooksEditor({ hooks, onChange, onError }: Props) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">
        Test expands the template with sample values and shows the exact command; nothing is run.
        Placeholders: {HOOK_PLACEHOLDERS.map((p) => p.token).join(' ')}
      </Typography>
      {HOOK_NAMES.map((name) => (
        <HookRow
          key={name}
          name={name}
          template={hooks[name]}
          onChange={(template) => onChange(name, template)}
          onError={onError}
        />
      ))}
    </Stack>
  )
}
