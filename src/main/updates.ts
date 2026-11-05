import { CancellationToken, type AppUpdater, type UpdateInfo } from 'electron-updater'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { UpdateState } from '../shared/types'
import { downloadUpdateFile, verifyUpdateFile, type UpdateFile } from './update-download'

export const RELEASE_URL = 'https://github.com/sd-softdev/ai-worktrees/releases'

interface Options {
  version: string
  packaged: boolean
  platform: string
  arch: string
  directory: string
  fetch: typeof fetch
  installMac: (filename: string, version: string) => Promise<void>
  installationPath?: string
  initialError?: string
}

export class UpdateService {
  private state: UpdateState
  private info?: UpdateInfo
  private file?: UpdateFile
  private downloaded?: string
  private operation: Promise<UpdateState> | null = null
  private cancellation?: CancellationToken
  private controller?: AbortController

  constructor(
    private updater: AppUpdater,
    private options: Options,
    private emit: (state: UpdateState) => void,
  ) {
    this.state = {
      status: options.packaged ? (options.initialError ? 'error' : 'idle') : 'unsupported',
      currentVersion: options.version,
      installation: options.platform === 'darwin' ? 'mac' : 'restart',
      installationPath: options.installationPath,
      error: options.initialError,
    }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    // Release manifests describe complete native packages, including unsigned DMGs.
    updater.disableDifferentialDownload = true
    updater.on('error', (error) => {
      if (!this.cancellation?.cancelled && !this.controller?.signal.aborted) this.fail(error)
    })
    updater.on('download-progress', (progress) => {
      if (this.state.status === 'downloading')
        this.set({
          progress: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
        })
    })
  }

  get snapshot(): UpdateState {
    return { ...this.state }
  }

  private set(value: Partial<UpdateState>): void {
    this.state = { ...this.state, ...value }
    this.emit(this.snapshot)
  }

  private fail(error: unknown): void {
    this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
  }

  private run(action: () => Promise<void>): Promise<UpdateState> {
    if (this.operation) return this.operation
    this.operation = action()
      .catch((error) => this.fail(error))
      .then(() => this.snapshot)
      .finally(() => {
        this.operation = null
      })
    return this.operation
  }

  check(): Promise<UpdateState> {
    if (['unsupported', 'downloaded', 'installing'].includes(this.state.status))
      return Promise.resolve(this.snapshot)
    return this.run(async () => {
      this.set({ status: 'checking', version: undefined, error: undefined, progress: undefined })
      this.info = undefined
      const result = await this.updater.checkForUpdates()
      if (!result) {
        this.set({ status: 'unsupported' })
        return
      }
      this.info = result.isUpdateAvailable ? result.updateInfo : undefined
      this.set({
        status: result.isUpdateAvailable ? 'available' : 'up-to-date',
        version: this.info?.version,
        checkedAt: new Date().toISOString(),
      })
    })
  }

  download(): Promise<UpdateState> {
    if (!this.info || !['available', 'error'].includes(this.state.status))
      return Promise.resolve(this.snapshot)
    return this.run(async () => {
      this.set({
        status: 'downloading',
        progress: 0,
        transferred: 0,
        total: undefined,
        error: undefined,
      })
      this.cancellation = new CancellationToken()
      this.controller = new AbortController()
      try {
        if (this.state.installation === 'mac') {
          const name = `agent-workspace-${this.info!.version}-mac-${this.options.arch}.dmg`
          const file = this.info!.files.find((file) => file.url === name)
          if (
            !file ||
            !Number.isSafeInteger(file.size) ||
            !file.size ||
            file.size < 0 ||
            file.size > 2 * 1024 ** 3 ||
            !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)
          )
            throw new Error('This release does not contain a verified installer for this Mac.')
          if (!/^\d+\.\d+\.\d+$/.test(this.info!.version))
            throw new Error('The release version is invalid.')
          this.file = {
            name,
            url: `${RELEASE_URL}/download/v${this.info!.version}/${name}`,
            size: file.size,
            sha512: file.sha512,
          }
          if (this.downloaded)
            await rm(path.dirname(this.downloaded), { recursive: true, force: true })
          this.downloaded = undefined
          this.downloaded = await downloadUpdateFile(
            this.file,
            this.options.directory,
            this.options.fetch,
            this.controller.signal,
            (transferred, total) =>
              this.set({ transferred, total, progress: (transferred / total) * 100 }),
          )
        } else {
          await this.updater.downloadUpdate(this.cancellation)
        }
        this.set({ status: 'downloaded', progress: 100 })
      } catch (error) {
        if (this.cancellation.cancelled || this.controller.signal.aborted)
          this.set({ status: 'available', progress: undefined, error: undefined })
        else throw error
      } finally {
        this.cancellation = undefined
        this.controller = undefined
      }
    })
  }

  cancel(): void {
    this.cancellation?.cancel()
    this.controller?.abort()
  }

  // The main process confirms active terminals and flushes settings before this handoff.
  install(): Promise<UpdateState> {
    if (this.state.status !== 'downloaded') return Promise.resolve(this.snapshot)
    return this.run(async () => {
      this.set({ status: 'installing', error: undefined })
      if (this.state.installation === 'mac') {
        if (!this.downloaded || !this.file) throw new Error('Please download the update again.')
        await verifyUpdateFile(this.downloaded, this.file)
        await this.options.installMac(this.downloaded, this.info!.version)
      } else {
        this.updater.quitAndInstall(false, true)
      }
    })
  }
}
