import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { configTokens, configuredHosts, shellQuote } from '../src/main/ssh/config'

let directory: string
beforeEach(async () => {
  const base = path.join(os.tmpdir(), 'opencode')
  await mkdir(base, { recursive: true })
  directory = await mkdtemp(path.join(base, 'aw-ssh-config-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

it('discovers concrete aliases through quoted includes without looping', async () => {
  await mkdir(path.join(directory, 'hosts with spaces'))
  await writeFile(
    path.join(directory, 'config'),
    'Host workstation other\n HostName example.invalid\nInclude "hosts with spaces/*.conf"\nHost *.internal !excluded *\n',
  )
  await writeFile(
    path.join(directory, 'hosts with spaces', 'dev.conf'),
    'Host "dev-server" # comment\nInclude config\n',
  )
  expect(await configuredHosts(path.join(directory, 'config'))).toEqual([
    { alias: 'dev-server' },
    { alias: 'other' },
    { alias: 'workstation' },
  ])
  expect(configTokens('HostName="host.example" # comment')).toEqual(['HostName', 'host.example'])
})

it.runIf(process.platform !== 'win32')(
  'quotes remote paths as one literal shell argument',
  async () => {
    const value = "/tmp/a b/'quoted'; $(printf injected)\nnext"
    const { stdout } = await promisify(execFile)('/bin/sh', [
      '-c',
      `printf %s ${shellQuote(value)}`,
    ])
    expect(stdout).toBe(value)
  },
)
