import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { remoteCommand, startupError } from '../src/main/ssh/bootstrap'
import { shellQuote } from '../src/main/ssh/config'

describe.skipIf(process.platform === 'win32')('remote runtime preflight', () => {
  let directory: string
  beforeEach(async () => {
    const base = path.join(os.tmpdir(), 'opencode')
    await mkdir(base, { recursive: true })
    directory = await mkdtemp(path.join(base, 'ssh-bootstrap-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function run(nodePath: string) {
    return spawnSync('/bin/sh', ['-c', remoteCommand(nodePath)], {
      env: { ...process.env, SHELL: '/bin/sh' },
      encoding: 'utf8',
      timeout: 10_000,
      input: Buffer.from('console.log("STREAMED_AGENT_READY")').toString('base64') + '\n',
    })
  }

  it('explains a missing executable before starting the agent', () => {
    const target = { host: 'dev-host', nodePath: path.join(directory, 'missing node') }
    const result = run(target.nodePath)
    expect(result.status).toBe(127)
    expect(startupError(result.stderr, target).message).toContain(
      'Node.js was not found on dev-host',
    )
    expect(startupError(result.stderr, target).message).toContain('Install Node.js 20+')
    expect(startupError(result.stderr, target).message).toContain('absolute executable path')
  })

  it('rejects an old runtime before evaluating the bundled source', async () => {
    const preload = path.join(directory, 'old-version.cjs')
    await writeFile(preload, 'Object.defineProperty(process.versions, "node", {value: "18.20.0"})')
    const executable = path.join(directory, 'old-node')
    await writeFile(
      executable,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} --require ${shellQuote(preload)} "$@"\n`,
    )
    await chmod(executable, 0o700)
    const result = run(executable)
    expect(result.status).toBe(78)
    expect(result.stdout).not.toContain('STREAMED_AGENT_READY')
    expect(
      startupError(result.stderr, { host: 'dev-host', nodePath: executable }).message,
    ).toContain('older than version 20')
  })

  it('streams the agent to an executable with spaces and quotes in its path', async () => {
    const executable = path.join(directory, "user's node executable")
    await symlink(process.execPath, executable)
    const result = run(executable)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('STREAMED_AGENT_READY')
  })
})
