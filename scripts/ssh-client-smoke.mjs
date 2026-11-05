import { build } from 'vite'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// Run the actual TerminalService against Electron's native PTY ABI, not Node's.
await build({
  configFile: false,
  build: {
    outDir: 'artifacts/ssh-client',
    emptyOutDir: true,
    ssr: 'tests/ssh-client.integration.ts',
    target: 'node22',
    rollupOptions: {
      external: ['node-pty'],
      output: { format: 'cjs', entryFileNames: 'test.cjs' },
    },
  },
})
const executable =
  process.env.AGENT_WORKSPACE_EXECUTABLE ||
  path.resolve(
    process.platform === 'win32'
      ? 'dist/win-unpacked/Agent Workspace.exe'
      : process.platform === 'darwin'
        ? `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Agent Workspace.app/Contents/MacOS/Agent Workspace`
        : 'dist/linux-unpacked/agent-workspace',
  )
const result = spawnSync(executable, [path.resolve('artifacts/ssh-client/test.cjs')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  timeout: 60_000,
})
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`SSH client test failed: ${result.status}`)
