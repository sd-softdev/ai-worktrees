import { build } from 'vite'

await build({
  configFile: false,
  build: {
    outDir: 'out/remote',
    emptyOutDir: true,
    ssr: 'src/remote/agent.ts',
    target: 'node20',
    minify: true,
    rollupOptions: {
      external: /^node:/,
      output: { format: 'cjs', entryFileNames: 'agent.cjs' },
    },
  },
  ssr: { noExternal: true },
})
