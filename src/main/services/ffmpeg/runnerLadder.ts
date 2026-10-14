/**
 * The attempt ladder (research §7.2). Each attempt is all-or-nothing and gives the builder its
 * `{encoder, hwaccel, strategy}`:
 *
 *   hw pass:  per encoder, `direct` then `copyThenCut`   (skipped when GPU decoding is off)
 *   cpu pass: the same again with `hwaccel = false`
 *
 * Default chain `h264_nvenc, libx264` gives 8 attempts (4 without GPU decoding).
 */

export type Strategy = 'direct' | 'copyThenCut'

export interface Attempt {
  readonly encoder: string
  readonly hwaccel: boolean
  readonly strategy: Strategy
}

const STRATEGIES: readonly Strategy[] = ['direct', 'copyThenCut']

export function buildLadder(encoders: readonly string[], gpu: boolean): Attempt[] {
  const chain = [...new Set(encoders)]
  const passes = gpu ? [true, false] : [false]
  const attempts: Attempt[] = []
  for (const hwaccel of passes) {
    for (const encoder of chain) {
      for (const strategy of STRATEGIES) attempts.push({ encoder, hwaccel, strategy })
    }
  }
  return attempts
}

export function describeAttempt(attempt: Attempt, index: number, total: number): string {
  const decode = attempt.hwaccel ? 'GPU decode' : 'CPU decode'
  const strategy = attempt.strategy === 'direct' ? 'direct cut' : 'copy then cut'
  return `Attempt ${index + 1}/${total}: ${attempt.encoder}, ${decode}, ${strategy}`
}
