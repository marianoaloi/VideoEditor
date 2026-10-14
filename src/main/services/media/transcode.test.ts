import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Fake {
  kill: ReturnType<typeof vi.fn>
  finish(): void
}
const fakes: Fake[] = []

vi.mock('../process/run', () => ({
  spawnStream: vi.fn(() => {
    let finish: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    const kill = vi.fn(() => finish())
    fakes.push({ kill, finish })
    return { stdout: new PassThrough(), done, kill }
  })
}))

import { activeTranscodeCount, killAllTranscodes, MAX_TRANSCODE_STREAMS, transcodeResponse } from './transcode'

beforeEach(() => {
  fakes.length = 0
})
afterEach(() => {
  killAllTranscodes()
})

const start = (): Response => transcodeResponse('ffmpeg', 'C:/v.mkv', 0, new AbortController().signal)

describe('transcode streams are capped (review L3)', () => {
  it('defaults to two and evicts the oldest stream when a third starts (a seek)', () => {
    expect(MAX_TRANSCODE_STREAMS).toBe(2)
    start()
    start()
    expect(activeTranscodeCount()).toBe(2)
    start()
    expect(fakes[0]?.kill).toHaveBeenCalled()
    expect(fakes[1]?.kill).not.toHaveBeenCalled()
    expect(fakes[2]?.kill).not.toHaveBeenCalled()
  })

  it('a finished stream frees its slot', async () => {
    start()
    fakes[0]?.finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(activeTranscodeCount()).toBe(0)
  })

  it('killAllTranscodes (app quit) kills everything that runs', () => {
    start()
    start()
    killAllTranscodes()
    expect(fakes.every((f) => f.kill.mock.calls.length > 0)).toBe(true)
    expect(activeTranscodeCount()).toBe(0)
  })
})
