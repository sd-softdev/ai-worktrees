import { connect } from 'node:net'

const port = Number(process.env.AGENT_WORKSPACE_ASKPASS_PORT)
const token = process.env.AGENT_WORKSPACE_ASKPASS_TOKEN
if (!port || !token) process.exit(1)
const socket = connect({ host: '127.0.0.1', port })
const timer = setTimeout(() => process.exit(1), 120_000)
let buffer = ''
let answered = false
socket.on('connect', () =>
  socket.write(JSON.stringify({ token, prompt: process.argv.slice(2).join(' ') }) + '\n'),
)
socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  if (buffer.length > 16_384) process.exit(1)
  if (!buffer.includes('\n')) return
  try {
    const { answer } = JSON.parse(buffer.split('\n')[0])
    if (typeof answer !== 'string') process.exit(1)
    answered = true
    process.stdout.write(answer.replace(/[\r\n]/g, '') + '\n', () => process.exit(0))
  } catch {
    process.exit(1)
  }
})
socket.on('error', () => process.exit(1))
socket.on('close', () => {
  clearTimeout(timer)
  if (!answered) process.exit(1)
})
