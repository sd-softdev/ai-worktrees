import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { HookPreferences, HookRun, Workspace, Worktree } from '../shared/types'
import { loginShellPath } from './shell-path'

interface Job {
  run: HookRun
  cancelled: boolean
  child?: ChildProcess
}

function stop(child?: ChildProcess): void {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    const killer = spawn(
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
      ['/pid', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    )
    killer.on('error', () => child.kill())
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

const expandHome = (value: string) =>
  value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value

// Shared by Electron and the SSH agent. Only explicitly configured hooks run;
// Git refreshes and application startup never trigger a worktree.created event.
export class HookRunner {
  private jobs = new Map<string, Job>()

  snapshots(): HookRun[] {
    return [...this.jobs.values()].map(({ run }) => ({ ...run }))
  }

  start(workspace: Workspace, worktree: Worktree, preferences: HookPreferences): HookRun {
    if (this.jobs.get(worktree.path)?.run.status === 'running')
      throw new Error('Setup is already running for this worktree.')
    const hooks = structuredClone(preferences.created.filter((hook) => hook.enabled))
    if (!hooks.length) throw new Error('Configure an enabled Worktree created hook first.')
    for (const [directory, old] of this.jobs) {
      if (this.jobs.size < 200) break
      if (old.run.status !== 'running') this.jobs.delete(directory)
    }
    const job: Job = {
      cancelled: false,
      run: {
        id: randomUUID(),
        revision: 0,
        worktreePath: worktree.path,
        status: 'running',
        step: 0,
        total: hooks.length,
        name: 'Preparing setup',
        output: '',
        startedAt: Date.now(),
      },
    }
    this.jobs.set(worktree.path, job)
    void this.execute(job, workspace, worktree, { ...preferences, created: hooks })
    return { ...job.run }
  }

  cancel(directory: string): void {
    const job = this.jobs.get(directory)
    if (!job || job.run.status !== 'running') return
    job.cancelled = true
    stop(job.child)
  }

  clear(): void {
    for (const directory of this.jobs.keys()) this.cancel(directory)
    this.jobs.clear()
  }

  private append(job: Job, text: string): void {
    job.run.output = (job.run.output + text).slice(-65_536)
    job.run.revision++
  }

  private command(
    job: Job,
    file: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    timeout: number,
    capture = false,
  ): Promise<string> {
    if (job.cancelled) return Promise.reject(new Error('Setup cancelled.'))
    return new Promise((resolve, reject) => {
      let output = ''
      let timedOut = false
      const child = spawn(file, args, {
        cwd: job.run.worktreePath,
        env,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      job.child = child
      const timer = setTimeout(() => {
        timedOut = true
        stop(child)
      }, timeout)
      const collect = (data: string) => {
        if (capture) output = (output + data).slice(-65_536)
        else this.append(job, data)
      }
      child.stdout!.setEncoding('utf8').on('data', collect)
      child.stderr!.setEncoding('utf8').on('data', collect)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        if (job.child === child) job.child = undefined
        if (job.cancelled) reject(new Error('Setup cancelled.'))
        else if (timedOut) reject(new Error(`Hook timed out after ${timeout / 1000} seconds.`))
        else if (code !== 0) reject(new Error(`Hook exited with ${signal || `code ${code}`}.`))
        else resolve(output)
      })
    })
  }

  private async execute(
    job: Job,
    workspace: Workspace,
    worktree: Worktree,
    preferences: HookPreferences,
  ): Promise<void> {
    try {
      const env = { ...process.env }
      for (const key of Object.keys(env))
        if (key.startsWith('ELECTRON_') || key === 'NODE_OPTIONS') delete env[key]
      if (process.platform !== 'win32') env.PATH = (await loginShellPath()) || env.PATH
      Object.assign(env, {
        WORKTREE_EVENT: 'worktree.created',
        WORKTREE_PATH: worktree.path,
        WORKTREE_BRANCH: worktree.branch || '',
        REPOSITORY_PATH: workspace.rootPath,
        GIT_TERMINAL_PROMPT: '0',
        NO_COLOR: '1',
      })
      for (const [index, hook] of preferences.created.entries()) {
        if (job.cancelled) throw new Error('Setup cancelled.')
        job.run.step = index + 1
        job.run.name = hook.name
        this.append(job, `\n[${index + 1}/${job.run.total}] ${hook.name}\n`)
        const node = expandHome(preferences.nodePath)
        if (hook.kind === 'typescript') {
          const version = await this.command(job, node, ['--version'], env, 5000, true)
          const match = /^v?(\d+)\.(\d+)\./m.exec(version.trim())
          if (!match || Number(match[1]) < 22 || (Number(match[1]) === 22 && Number(match[2]) < 18))
            throw new Error(
              'TypeScript hooks require Node.js 22.18 or later on the execution host.',
            )
        }
        if (hook.kind === 'shell') {
          const windows = process.platform === 'win32'
          const shell = windows
            ? process.env.COMSPEC || 'cmd.exe'
            : process.env.SHELL || os.userInfo().shell || '/bin/sh'
          await this.command(
            job,
            shell,
            windows ? ['/d', '/s', '/c', hook.command] : ['-c', hook.command],
            env,
            hook.timeoutSeconds * 1000,
          )
        } else {
          const filename = path.resolve(worktree.path, expandHome(hook.command))
          const args = [
            ...(hook.kind === 'typescript' ? ['--experimental-strip-types'] : []),
            filename,
            ...hook.args,
          ]
          await this.command(job, node, args, env, hook.timeoutSeconds * 1000)
        }
      }
      job.run.status = 'succeeded'
    } catch (error) {
      job.run.status = job.cancelled ? 'cancelled' : 'failed'
      job.run.error = (error instanceof Error ? error.message : String(error)).slice(0, 16_384)
      this.append(job, `\n${job.run.error}\n`)
    } finally {
      job.run.finishedAt = Date.now()
      job.run.revision++
    }
  }
}
