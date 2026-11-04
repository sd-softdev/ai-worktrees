import { readFileSync, writeFileSync } from 'node:fs'

const [action, ...args] = process.argv.slice(2)

switch (action) {
  case 'ready':
    console.log(`${args[0]}_READY`)
    break
  case 'session':
    console.log(`${args[1]}=${process.env[args[0]] ?? ''}`)
    break
  case 'feature':
    writeFileSync('src/auth.ts', 'export const login = true\n')
    console.log('FEATURE_READY')
    break
  case 'unicode':
    console.log('UNICODE_Grüße_日本')
    break
  case 'flood':
    process.stdout.write('OUTPUT_LOAD_abcdefghijklmnopqrstuvwxyz\n'.repeat(20_000))
    process.stdout.write('FLOW_CONTROL_COMPLETE\n')
    break
  case 'tui': {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('A real PTY is required')
    const text = readFileSync('README.md', 'utf8').replaceAll('\n', '\r\n')
    const render = () => process.stdout.write(`\x1b[2J\x1b[H${text}\r\nPress q to exit.\r\n`)
    process.stdin.setRawMode(true)
    process.stdout.write('\x1b[?1049h')
    render()
    process.stdout.on('resize', render)
    process.stdin.on('data', (data) => {
      if (data.includes('q') || data.includes(3)) {
        process.stdin.setRawMode(false)
        process.stdout.write('\x1b[?1049l', () => process.exit(0))
      }
    })
    break
  }
  default:
    throw new Error(`Unknown terminal probe: ${action}`)
}
