import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createPackageWithOptions, extractAll } from '@electron/asar'

export async function macUpdateFixture(directory, originalExecutable, version) {
  const original = path.resolve(path.dirname(originalExecutable), '../..')
  const current = path.join(directory, "Home's Applications", 'Agent Workspace.app')
  const image = path.join(directory, 'image')
  const next = path.join(image, 'Agent Workspace.app')
  const alternate = path.join(directory, 'System Applications', 'Agent Workspace.app')
  const receipt = path.join(directory, 'relaunch.json')
  await mkdir(path.dirname(current), { recursive: true })
  await mkdir(image)
  await mkdir(alternate, { recursive: true })
  await writeFile(path.join(alternate, 'keep.txt'), 'Other installation must remain untouched.')
  execFileSync('/usr/bin/ditto', [original, current])
  execFileSync('/usr/bin/ditto', [original, next])
  const archive = path.join(next, 'Contents/Resources/app.asar')
  const source = path.join(directory, 'next-source')
  extractAll(archive, source)
  const metadataFile = path.join(source, 'package.json')
  const metadata = JSON.parse(await readFile(metadataFile, 'utf8'))
  const main = metadata.main
  metadata.version = version
  metadata.main = 'update-test-bootstrap.cjs'
  await writeFile(metadataFile, JSON.stringify(metadata))
  // Only the replacement fixture records its launch and exits. The old app uses
  // the production updater, including its real quit, bundle replacement and restart.
  await writeFile(
    path.join(source, metadata.main),
    `
const { app, dialog } = require('electron')
const { writeFileSync } = require('node:fs')
dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    const update = await window.webContents.executeJavaScript('window.desktop.updateState()')
    writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({
      version: app.getVersion(), executable: process.execPath, userData: app.getPath('userData'),
      update, pid: process.pid,
    }))
    app.quit()
  })
})
require(${JSON.stringify('./' + main)})
`,
  )
  await createPackageWithOptions(source, archive, { unpack: '**/{node-pty,askpass.js}/**' })
  const plist = path.join(next, 'Contents/Info.plist')
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion'])
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set ${key} ${version}`, plist])
  const dmg = path.join(directory, `agent-workspace-${version}-mac-${process.arch}.dmg`)
  execFileSync(
    '/usr/bin/hdiutil',
    ['create', '-srcfolder', image, '-format', 'UDZO', '-volname', 'Update fixture', dmg],
    { timeout: 120_000 },
  )
  return {
    executable: path.join(current, 'Contents/MacOS/Agent Workspace'),
    bundle: current,
    alternate,
    receipt,
    dmg,
  }
}
