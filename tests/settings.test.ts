import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/settings'
import { defaultPreferences } from '../src/shared/types'
import { preferencesSchema } from '../src/main/schema'

let directory: string
beforeEach(async () => {
  const base = path.join(os.tmpdir(), 'opencode')
  await mkdir(base, { recursive: true })
  directory = await mkdtemp(path.join(base, 'agent-workspace-settings-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

it('loads the latest queued layout and isolates metadata by repository', async () => {
  const settings = new SettingsStore(directory)
  const first = { ...defaultPreferences(), leftWidth: 240 }
  const last = { ...defaultPreferences(), leftWidth: 320, targetBranch: 'main' }
  const saves = [settings.save('/repo-one/.git', first), settings.save('/repo-one/.git', last)]
  expect(await settings.load('/repo-one/.git')).toEqual(last)
  await Promise.all(saves)
  await settings.save('/repo-two/.git', first)
  await settings.remember('/repo-two')
  await settings.flush()
  const restarted = new SettingsStore(directory)
  expect(await restarted.load('/repo-one/.git')).toEqual(last)
  expect(await restarted.load('/repo-two/.git')).toEqual(first)
  expect(await restarted.lastWorkspace()).toBe('/repo-two')
})

it('adds optional review preferences to existing layouts without resetting them', () => {
  const { reviews: _reviews, ...previous } = {
    ...defaultPreferences(),
    leftWidth: 315,
    targetBranch: 'develop',
  }
  expect(preferencesSchema.parse(previous)).toEqual({
    ...previous,
    reviews: { provider: 'auto', remote: '' },
  })
})
