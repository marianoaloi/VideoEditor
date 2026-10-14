import { describe, expect, it } from 'vitest'

describe('node test project', () => {
  it('runs in a Node environment without a DOM', () => {
    expect(typeof window).toBe('undefined')
    expect(Number.parseInt(process.versions.node, 10)).toBeGreaterThanOrEqual(22)
  })

  it('loads the native sharp addon and the ESM-only file-type package', async () => {
    const { default: sharp } = await import('sharp')
    const { fileTypeFromBuffer } = await import('file-type')
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#336699' }
    })
      .png()
      .toBuffer()

    expect(await fileTypeFromBuffer(png)).toMatchObject({ ext: 'png', mime: 'image/png' })
  })
})
