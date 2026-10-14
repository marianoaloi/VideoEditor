import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Builds the app once per run so the tests exercise the real bundles in `out/`. */
export default function globalSetup(): void {
  const root = process.cwd()
  if (process.env['E2E_SKIP_BUILD'] !== '1') {
    execSync('npm run build', { cwd: root, stdio: 'inherit' })
  }
  if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
    throw new Error('out/main/index.js is missing: run `npm run build`')
  }
}
