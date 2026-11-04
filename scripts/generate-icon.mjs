import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(os.tmpdir(), 'opencode')
await mkdir(base, { recursive: true })
const profile = await mkdtemp(path.join(base, 'agent-workspace-icon-'))
const env = { ...process.env, AGENT_WORKSPACE_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
delete env.AGENT_WORKSPACE_OPEN
const app = await electron.launch({ args: [project], env })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const svg = await readFile(path.join(project, 'build/icon.svg'), 'utf8')
  const png = await page.evaluate(async (svg) => {
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    canvas.getContext('2d').drawImage(image, 0, 0)
    return canvas.toDataURL('image/png').split(',')[1]
  }, svg)
  await writeFile(path.join(project, 'build/icon.png'), Buffer.from(png, 'base64'))
  console.log('Generated build/icon.png from build/icon.svg')
} finally {
  await app.close()
  await rm(profile, { recursive: true, force: true })
}
