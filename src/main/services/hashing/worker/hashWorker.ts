/** Worker-thread entry: runs one hash job at a time and posts back the keys or an error message. */
import { parentPort } from 'node:worker_threads'
import { hashImageFile, hashVideoFile } from './hashCore'
import type { FromWorker, HashJob, ToWorker } from './protocol'

const port = parentPort
const running = new Map<number, AbortController>()

function post(message: FromWorker): void {
  port?.postMessage(message)
}

async function execute(job: HashJob, signal: AbortSignal) {
  return job.op === 'image'
    ? hashImageFile(job.path, job.cascade, job.maxPixels)
    : hashVideoFile(job.path, job.tools, job.cascade, job.maxPixels, signal)
}

async function handleJob(job: HashJob): Promise<void> {
  const controller = new AbortController()
  running.set(job.id, controller)
  try {
    post({ type: 'result', id: job.id, keys: await execute(job, controller.signal) })
  } catch (error) {
    post({ type: 'error', id: job.id, message: error instanceof Error ? error.message : String(error) })
  } finally {
    running.delete(job.id)
  }
}

port?.on('message', (message: ToWorker) => {
  if (message.type === 'cancel') running.get(message.id)?.abort()
  else void handleJob(message.job)
})
