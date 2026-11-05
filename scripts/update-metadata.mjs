import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export async function updateFileInfo(directory, name) {
  const filename = path.join(directory, name)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return { url: name, sha512: hash.digest('base64'), size: (await stat(filename)).size }
}

// Assemble metadata after all native builds have passed. In particular, both
// macOS architectures must share one manifest instead of overwriting each other.
export async function writeUpdateMetadata(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version')
  const prefix = `agent-workspace-${version}`
  const channels = {
    'latest.yml': [`${prefix}-win-x64.exe`],
    'latest-linux.yml': [`${prefix}-linux-x86_64.AppImage`, `${prefix}-linux-amd64.deb`],
    'latest-mac.yml': [`${prefix}-mac-arm64.dmg`, `${prefix}-mac-x64.dmg`],
  }
  for (const [name, assets] of Object.entries(channels)) {
    const files = await Promise.all(assets.map((name) => updateFileInfo(directory, name)))
    // JSON is also valid YAML, consumed by electron-updater without a YAML dependency here.
    await writeFile(
      path.join(directory, name),
      JSON.stringify(
        {
          version,
          files,
          path: files[0].url,
          sha512: files[0].sha512,
          releaseDate: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    )
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  )
  await writeUpdateMetadata(path.resolve(process.argv[2] || 'release'), version)
  console.log(`Update metadata generated for ${version}: Windows, Linux, macOS ARM64 + Intel.`)
}
