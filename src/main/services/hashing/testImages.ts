/** Test-only helpers: synthetic images made with sharp. Never import from production code. */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

/** RGB test pattern: gradient with a bright square and a dark bar. */
export function patternRgb(width: number, height: number, seed = 0): Buffer {
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      const fx = x / width
      const fy = y / height
      let r = Math.round(40 + 160 * fx)
      let g = Math.round(200 - 140 * fy)
      let b = Math.round(60 + 120 * Math.sin((fx + fy + seed) * 6) ** 2)
      if (fx > 0.55 && fx < 0.85 && fy > 0.2 && fy < 0.5) [r, g, b] = [250, 240, 20]
      if (fy > 0.7 && fy < 0.8) [r, g, b] = [10, 10, 30]
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
    }
  }
  return data
}

export type TestFormat = 'png' | 'jpeg' | 'webp' | 'gif'

export async function writePattern(
  dir: string,
  name: string,
  format: TestFormat,
  size: { width: number; height: number } = { width: 160, height: 120 },
  seed = 0
): Promise<string> {
  const out = path.join(dir, name)
  const raw = sharp(patternRgb(size.width, size.height, seed), {
    raw: { width: size.width, height: size.height, channels: 3 }
  })
  const encoded =
    format === 'png'
      ? raw.png()
      : format === 'jpeg'
        ? raw.jpeg({ quality: 95 })
        : format === 'webp'
          ? raw.webp({ quality: 95 })
          : raw.gif()
  await writeFile(out, await encoded.toBuffer())
  return out
}
