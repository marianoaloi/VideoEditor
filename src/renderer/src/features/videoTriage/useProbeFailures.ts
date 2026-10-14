/**
 * Videos ffprobe cannot read (video-triage.md §2, "Error move R"):
 * - with "Error move R" on, each one goes straight to R and ONE summary toast follows, with a log
 *   that lists every file and why;
 * - with it off, the current video gets its own error toast with the log icon.
 */
import { useEffect, useRef } from 'react'
import { basename } from '@shared/core/paths'
import type { SerializedError } from '../../app/api'
import { useAppDispatch } from '../../app/hooks'
import { describeFileError, joinLogs } from '../../app/notifications/errorLog'
import { notify } from '../../app/notifications/notify'
import { videoTriageThunks } from './videoTriageSlice'

interface Args {
  /** Path of the current item, `null` when there is none. */
  itemPath: string | null
  /** The probe error of the current item, `null` while it is fine or not probed yet. */
  failure: SerializedError | null
  /** The current item was probed successfully. */
  ready: boolean
  /** The list is finished. */
  atEnd: boolean
  errorMoveR: boolean
}

/** First line of an ffprobe message, short enough for the toast. */
function headline(message: string): string {
  const first = message.split(/\r?\n/).find((line) => line.trim() !== '') ?? message
  return first.length > 160 ? `${first.slice(0, 157)}...` : first
}

export function useProbeFailures({ itemPath, failure, ready, atEnd, errorMoveR }: Args): void {
  const dispatch = useAppDispatch()
  const moved = useRef<{ blocks: string[]; last: string | null }>({ blocks: [], last: null })
  const toasted = useRef<string | null>(null)

  useEffect(() => {
    if (itemPath !== null && failure !== null) {
      const log = describeFileError('Cannot read this video', itemPath, failure)
      if (errorMoveR) {
        if (moved.current.last === itemPath) return
        moved.current.last = itemPath
        moved.current.blocks.push(log)
        void dispatch(videoTriageThunks.moveItem({ kind: 'right' }))
      } else if (toasted.current !== itemPath) {
        toasted.current = itemPath
        dispatch(
          notify('error', `Cannot read ${basename(itemPath)}`, {
            detail: headline(failure.message),
            log
          })
        )
      }
      return
    }
    const count = moved.current.blocks.length
    if (count > 0 && (ready || atEnd)) {
      const noun = count === 1 ? 'file' : 'files'
      dispatch(
        notify('warning', `${String(count)} unreadable ${noun} moved to R`, {
          log: joinLogs(moved.current.blocks)
        })
      )
      moved.current.blocks = []
    }
  }, [dispatch, itemPath, failure, ready, atEnd, errorMoveR])
}
