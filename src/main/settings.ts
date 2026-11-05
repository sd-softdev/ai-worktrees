import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  defaultPreferences,
  type RemoteWorkspaceReference,
  type WorkspacePreferences,
} from '../shared/types'
import { preferencesSchema, remoteReferenceSchema } from './schema'

export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private directory: string) {}

  private filename(commonDir: string): string {
    const key = createHash('sha256').update(commonDir).digest('hex')
    return path.join(this.directory, `workspace-${key}.json`)
  }

  async load(commonDir: string): Promise<WorkspacePreferences> {
    await this.queue
    try {
      return preferencesSchema.parse(JSON.parse(await readFile(this.filename(commonDir), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Could not load workspace settings:', error)
      }
      return defaultPreferences()
    }
  }

  async lastWorkspace(): Promise<string | null> {
    try {
      const value: unknown = JSON.parse(
        await readFile(path.join(this.directory, 'recent.json'), 'utf8'),
      )
      return typeof value === 'string' ? value : null
    } catch {
      return null
    }
  }

  async lastRemote(): Promise<RemoteWorkspaceReference | null> {
    try {
      const value: unknown = JSON.parse(
        await readFile(path.join(this.directory, 'recent.json'), 'utf8'),
      )
      const parsed = remoteReferenceSchema.safeParse(value)
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  private write(filename: string, value: unknown): Promise<void> {
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true })
        await writeFile(`${filename}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 })
        await rename(`${filename}.tmp`, filename)
      })
    this.queue = next
    return next
  }

  save(commonDir: string, preferences: WorkspacePreferences): Promise<void> {
    return this.write(this.filename(commonDir), preferences)
  }

  remember(rootPath: string | RemoteWorkspaceReference): Promise<void> {
    return this.write(path.join(this.directory, 'recent.json'), rootPath)
  }

  async flush(): Promise<void> {
    await this.queue
  }
}
