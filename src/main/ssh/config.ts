import { glob, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SshHost } from '../../shared/types'

export function sshConfigFile(): string {
  return process.env.AGENT_WORKSPACE_SSH_CONFIG || path.join(os.homedir(), '.ssh', 'config')
}

export function configTokens(line: string): string[] {
  const tokens: string[] = []
  let word = ''
  let quote = ''
  let escaped = false
  for (const character of line) {
    if (escaped) {
      word += character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = ''
      else word += character
    } else if (character === '"' || character === "'") quote = character
    else if (character === '#') break
    else if (/\s/.test(character) || (character === '=' && tokens.length === 0)) {
      if (word) {
        tokens.push(word)
        word = ''
      }
    } else word += character
  }
  if (escaped) word += '\\'
  if (word) tokens.push(word)
  return tokens
}

export async function configuredHosts(filename = sshConfigFile()): Promise<SshHost[]> {
  const seen = new Set<string>()
  const aliases = new Set<string>()
  const base = path.dirname(filename)
  const visit = async (file: string, depth: number): Promise<void> => {
    if (depth > 12 || seen.has(file) || seen.size >= 200) return
    seen.add(file)
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const line of text.split(/\r?\n/)) {
      const [directive, ...values] = configTokens(line)
      if (directive?.toLowerCase() === 'host') {
        for (const alias of values)
          if (!/[*!?]/.test(alias) && !alias.startsWith('-')) aliases.add(alias)
      }
      if (directive?.toLowerCase() === 'include') {
        for (const value of values) {
          const pattern = value.startsWith('~/')
            ? path.join(os.homedir(), value.slice(2))
            : path.resolve(base, value)
          for await (const included of glob(pattern)) await visit(included, depth + 1)
        }
      }
    }
  }
  await visit(filename, 0)
  return [...aliases].sort((a, b) => a.localeCompare(b)).map((alias) => ({ alias }))
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function sshBaseArgs(): string[] {
  return [
    ...(process.env.AGENT_WORKSPACE_SSH_CONFIG ? ['-F', sshConfigFile()] : []),
    '-o',
    'ConnectTimeout=15',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=3',
  ]
}
