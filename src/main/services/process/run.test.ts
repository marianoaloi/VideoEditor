import { describe, expect, it } from 'vitest'
import { isSuccess, run, spawnStream, taskkillPath } from './run'

const NODE = process.execPath

describe('taskkillPath (review L2)', () => {
  it('is an absolute System32 path, never a bare name', () => {
    expect(taskkillPath({ SystemRoot: 'D:\\WINNT' })).toBe('D:\\WINNT\\System32\\taskkill.exe')
    expect(taskkillPath({})).toBe('C:\\Windows\\System32\\taskkill.exe')
  })
})

function script(code: string): string[] {
  return ['-e', code]
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitDead(pid: number, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!alive(pid)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !alive(pid)
}

describe('run', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const r = await run({
      command: NODE,
      args: script('process.stdout.write("out");process.stderr.write("err");process.exit(3)')
    })
    expect(r.status).toBe('exited')
    expect(r.exitCode).toBe(3)
    expect(r.stdout).toBe('out')
    expect(r.stderr).toBe('err')
    expect(isSuccess(r)).toBe(false)
  })

  it('passes arguments verbatim, never through a shell', async () => {
    const nasty = 'a b & echo pwned | "quoted" $HOME %PATH% `x`'
    const r = await run({
      command: NODE,
      args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', nasty, '--flag=1']
    })
    expect(isSuccess(r)).toBe(true)
    expect(JSON.parse(r.stdout)).toEqual([nasty, '--flag=1'])
  })

  it('streams lines split on \\n, \\r\\n and lone \\r, including a partial last line', async () => {
    const lines: string[] = []
    const r = await run({
      command: NODE,
      args: script('process.stdout.write("a\\nb\\r\\nc\\rd")'),
      onStdoutLine: (l) => lines.push(l)
    })
    expect(isSuccess(r)).toBe(true)
    expect(lines).toEqual(['a', 'b', 'c', 'd'])
  })

  it('streams stderr lines and can skip capturing', async () => {
    const lines: string[] = []
    const r = await run({
      command: NODE,
      args: script('console.error("e1");console.error("e2")'),
      onStderrLine: (l) => lines.push(l),
      captureStderr: false
    })
    expect(lines).toEqual(['e1', 'e2'])
    expect(r.stderr).toBe('')
  })

  it('merges env over process.env', async () => {
    const r = await run({
      command: NODE,
      args: script(
        'process.stdout.write(process.env.VE_TEST + "|" + (process.env.PATH ? "path" : ""))'
      ),
      env: { VE_TEST: 'x\ny' }
    })
    expect(r.stdout).toBe('x\ny|path')
  })

  it('reports a missing executable as spawn-error', async () => {
    const r = await run({ command: 'definitely-not-a-real-program-xyz', args: [] })
    expect(r.status).toBe('spawn-error')
    expect(r.error?.code).toBe('ENOENT')
    expect(r.exitCode).toBeNull()
  })

  it('truncates captured output at the cap', async () => {
    const r = await run({
      command: NODE,
      args: script('process.stdout.write("x".repeat(5000))'),
      maxCaptureBytes: 100
    })
    expect(r.stdout.length).toBe(100)
    expect(r.stdoutTruncated).toBe(true)
  })

  it('times out and kills the process', async () => {
    const r = await run({
      command: NODE,
      args: script('setInterval(()=>{},1000)'),
      timeoutMs: 300
    })
    expect(r.status).toBe('timeout')
    expect(r.durationMs).toBeLessThan(5000)
  })

  it('does not start when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const r = await run({ command: NODE, args: script('process.exit(0)'), signal: ac.signal })
    expect(r.status).toBe('cancelled')
  })

  it('kills the whole process tree on abort', async () => {
    const ac = new AbortController()
    const code = `
      const { spawn } = require('node:child_process');
      const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      process.stdout.write('PID:' + c.pid + '\\n');
      setInterval(()=>{},1000);
    `
    let childPid = 0
    const result = run({
      command: NODE,
      args: script(code),
      signal: ac.signal,
      onStdoutLine: (line) => {
        const m = /^PID:(\d+)$/.exec(line)
        if (m?.[1] !== undefined) {
          childPid = Number(m[1])
          ac.abort()
        }
      }
    })
    const r = await result
    expect(r.status).toBe('cancelled')
    expect(childPid).toBeGreaterThan(0)
    expect(await waitDead(childPid)).toBe(true)
  })
})

describe('spawnStream', () => {
  it('exposes raw stdout bytes', async () => {
    const proc = spawnStream({
      command: NODE,
      args: script('process.stdout.write(Buffer.from([0,1,2,255]))')
    })
    const chunks: Buffer[] = []
    for await (const chunk of proc.stdout) chunks.push(chunk as Buffer)
    const r = await proc.done
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 1, 2, 255]))
    expect(isSuccess(r)).toBe(true)
  })

  it('kill() ends the process with status cancelled', async () => {
    const proc = spawnStream({ command: NODE, args: script('setInterval(()=>{},1000)') })
    proc.stdout.resume()
    setTimeout(() => proc.kill(), 200)
    const r = await proc.done
    expect(r.status).toBe('cancelled')
  })
})
