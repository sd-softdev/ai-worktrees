import { createHash } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { downloadUpdateFile, verifyUpdateFile, type UpdateFile } from '../src/main/update-download'

let directory: string
let url: string
let respond: (response: ServerResponse) => void
const server = createServer((_request, response) => respond(response))
const content = Buffer.alloc(128 * 1024, 'verified update')
let file: UpdateFile

beforeEach(async () => {
  const base = path.join(os.tmpdir(), 'opencode')
  await mkdir(base, { recursive: true })
  directory = await mkdtemp(path.join(base, 'update-download-'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  url = `http://127.0.0.1:${address.port}/update.dmg`
  file = {
    name: 'update.dmg',
    url,
    size: content.length,
    sha512: createHash('sha512').update(content).digest('base64'),
  }
  respond = (response) => response.end(content)
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(directory, { recursive: true, force: true })
})

it('downloads real bytes, verifies them, and detects corruption before opening an installer', async () => {
  const progress: number[] = []
  const filename = await downloadUpdateFile(
    file,
    directory,
    fetch,
    new AbortController().signal,
    (value) => progress.push(value),
  )
  expect(await readFile(filename)).toEqual(content)
  expect(progress.at(-1)).toBe(content.length)
  await writeFile(filename, Buffer.alloc(content.length, 0))
  await expect(verifyUpdateFile(filename, file)).rejects.toThrow('checksum')
})

it.each(['corrupt', 'truncated', 'oversized', 'http-error'])(
  'rejects a %s download and removes its partial files',
  async (kind) => {
    respond = (response) => {
      if (kind === 'http-error') {
        response.writeHead(503)
        response.end('Unavailable')
      } else
        response.end(
          kind === 'corrupt'
            ? Buffer.alloc(content.length)
            : kind === 'truncated'
              ? content.subarray(0, 10)
              : Buffer.concat([content, content]),
        )
    }
    await expect(
      downloadUpdateFile(file, directory, fetch, new AbortController().signal, () => {}),
    ).rejects.toThrow()
    expect(await readdir(directory)).toEqual([])
  },
)

it('cancels an in-flight download, removes partial files, and allows a verified retry', async () => {
  const controller = new AbortController()
  respond = (response) => {
    response.write(content.subarray(0, 1024))
  }
  await expect(
    downloadUpdateFile(file, directory, fetch, controller.signal, () => controller.abort()),
  ).rejects.toThrow()
  expect(await readdir(directory)).toEqual([])
  respond = (response) => response.end(content)
  const filename = await downloadUpdateFile(
    file,
    directory,
    fetch,
    new AbortController().signal,
    () => {},
  )
  await expect(verifyUpdateFile(filename, file)).resolves.toBeUndefined()
})
