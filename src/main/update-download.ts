import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface UpdateFile {
  name: string
  url: string
  sha512: string
  size: number
}

export async function verifyUpdateFile(filename: string, expected: UpdateFile): Promise<void> {
  const hash = createHash('sha512')
  let size = 0
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk)
    size += chunk.length
  }
  if (size !== expected.size || hash.digest('base64') !== expected.sha512)
    throw new Error('Update checksum verification failed. Please download the update again.')
}

export async function downloadUpdateFile(
  file: UpdateFile,
  directory: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
  progress: (transferred: number, total: number) => void,
): Promise<string> {
  await mkdir(directory, { recursive: true })
  const temporary = await mkdtemp(path.join(directory, 'download-'))
  const filename = path.join(temporary, file.name)
  try {
    const response = await fetcher(file.url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]),
    })
    if (!response.ok || !response.body)
      throw new Error(`Could not download the update (HTTP ${response.status}).`)
    const reader = response.body.getReader()
    const source = Readable.from(
      (async function* () {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) return
            yield value
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      })(),
    )
    let transferred = 0
    let lastProgress = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferred += chunk.length
        if (transferred > file.size) {
          callback(new Error('The update download is larger than expected.'))
          return
        }
        if (Date.now() - lastProgress > 150 || transferred === file.size) {
          progress(transferred, file.size)
          lastProgress = Date.now()
        }
        callback(null, chunk)
      },
    })
    await pipeline(source, meter, createWriteStream(filename, { flags: 'wx', mode: 0o600 }), {
      signal,
    })
    await verifyUpdateFile(filename, file)
    signal.throwIfAborted()
    return filename
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}
