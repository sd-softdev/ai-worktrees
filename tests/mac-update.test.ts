import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { consumeMacUpdateError, installMacUpdate } from '../src/main/mac-update'

const exec = promisify(execFile)
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

describe.runIf(process.platform === 'darwin')('macOS in-place updates', () => {
  let directory: string
  let target: string
  let dmg: string
  let receipt: string
  let parent: ChildProcess
  const executable = () => path.join(target, 'Contents/MacOS/Agent Workspace')
  const options = () => ({
    executable: executable(),
    directory,
    pid: parent.pid!,
    args: ['argument with spaces'],
  })

  async function bundle(destination: string, version: string) {
    await mkdir(path.join(destination, 'Contents/MacOS'), { recursive: true })
    await writeFile(
      path.join(destination, 'Contents/Info.plist'),
      `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.agentworkspace.desktop</string>
<key>CFBundleExecutable</key><string>Agent Workspace</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>`,
    )
    await writeFile(
      path.join(destination, 'Contents/MacOS/Agent Workspace'),
      `#!/bin/sh\nprintf '%s\\n' '${version}' "$0" "$1" > ${quote(receipt)}\n`,
      { mode: 0o755 },
    )
  }

  beforeEach(async () => {
    const base = path.join(os.tmpdir(), 'opencode')
    await mkdir(base, { recursive: true })
    directory = await realpath(await mkdtemp(path.join(base, 'mac-update-test-')))
    target = path.join(directory, "User's Applications", 'Agent Workspace.app')
    receipt = path.join(directory, 'receipt')
    await bundle(target, '1.0.0')
    const image = path.join(directory, 'image')
    await bundle(path.join(image, 'Agent Workspace.app'), '2.0.0')
    dmg = path.join(directory, 'update.dmg')
    await exec('/usr/bin/hdiutil', ['create', '-srcfolder', image, '-format', 'UDZO', dmg])
    parent = spawn('/bin/sleep', ['120'])
    await once(parent, 'spawn')
  })

  afterEach(async () => {
    parent?.kill()
    await chmod(path.dirname(target), 0o755)
    await rm(directory, { recursive: true, force: true })
  })

  it('waits for exit, replaces the original path and relaunches with intact arguments', async () => {
    await installMacUpdate(dmg, '2.0.0', options())
    expect(await readFile(path.join(target, 'Contents/Info.plist'), 'utf8')).toContain('1.0.0')
    expect(await readFile(receipt, 'utf8').catch(() => '')).toBe('')
    parent.kill()
    await expect
      .poll(() => readFile(receipt, 'utf8').catch(() => ''))
      .toBe(`2.0.0\n${executable()}\nargument with spaces\n`)
    await expect
      .poll(async () =>
        (await readdir(path.dirname(target))).filter((name) =>
          name.startsWith('.agent-workspace-update-'),
        ),
      )
      .toEqual([])
  })

  it('restores and relaunches the old app when replacement fails after exit', async () => {
    await installMacUpdate(dmg, '2.0.0', options())
    const stage = (await readdir(path.dirname(target))).find((name) =>
      name.startsWith('.agent-workspace-update-'),
    )!
    await rm(path.join(path.dirname(target), stage, 'next.app'), { recursive: true })
    parent.kill()
    await expect
      .poll(() => readFile(receipt, 'utf8').catch(() => ''))
      .toBe(`1.0.0\n${executable()}\nargument with spaces\n`)
    expect(await consumeMacUpdateError(directory)).toContain('previous version was restored')
    expect(await consumeMacUpdateError(directory)).toBeUndefined()
  })

  it('rejects a mismatched bundle version before replacing the installed app', async () => {
    await expect(installMacUpdate(dmg, '3.0.0', options())).rejects.toThrow('unexpected version')
    expect(await readFile(path.join(target, 'Contents/Info.plist'), 'utf8')).toContain('1.0.0')
    expect(
      (await readdir(path.dirname(target))).filter((name) =>
        name.startsWith('.agent-workspace-update-'),
      ),
    ).toEqual([])
    expect(await readFile(receipt, 'utf8').catch(() => '')).toBe('')
  })

  it.skipIf(process.getuid?.() === 0)(
    'reports an unwritable destination before shutting down',
    async () => {
      await chmod(path.dirname(target), 0o555)
      await expect(installMacUpdate(dmg, '2.0.0', options())).rejects.toThrow('write permission')
      expect(await readFile(path.join(target, 'Contents/Info.plist'), 'utf8')).toContain('1.0.0')
    },
  )
})
