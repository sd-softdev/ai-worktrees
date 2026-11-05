import type { SshTarget } from '../../shared/types'
import { shellQuote } from './config'

const marker = 'AGENT_WORKSPACE_SETUP:'

export function remoteCommand(nodePath: string): string {
  // Check the runtime before evaluating the Node 20 bundle so older runtimes
  // produce an actionable error rather than a JavaScript syntax error.
  const loader = `if(Number(process.versions.node.split('.')[0])<20){console.error('${marker}NODE_TOO_OLD');process.exit(78)};if(!['linux','darwin'].includes(process.platform)){console.error('${marker}UNSUPPORTED_OS');process.exit(78)};let b="";const f=c=>{b+=c;const n=b.indexOf("\\n");if(n<0)return;process.stdin.removeListener("data",f);new Function("require","module","exports",Buffer.from(b.slice(0,n),"base64").toString())(require,module,exports)};process.stdin.on("data",f)`
  const script = [
    `command -v ${shellQuote(nodePath)} >/dev/null 2>&1 || { printf '%s\\n' '${marker}NODE_MISSING' >&2; exit 127; }`,
    `command -v git >/dev/null 2>&1 || { printf '%s\\n' '${marker}GIT_MISSING' >&2; exit 127; }`,
    `exec ${shellQuote(nodePath)} -e ${shellQuote(loader)}`,
  ].join('\n')
  // Load the user's login PATH, then use a POSIX shell for the preflight even
  // when their login shell is fish or another non-POSIX shell.
  const login = `exec "\${SHELL:-/bin/sh}" -lc ${shellQuote(`exec sh -c ${shellQuote(script)}`)}`
  return `exec /bin/sh -c ${shellQuote(login)}`
}

export function startupError(diagnostic: string, target: SshTarget): Error {
  if (
    diagnostic.includes(`${marker}NODE_MISSING`) ||
    diagnostic.includes(`${marker}NODE_TOO_OLD`)
  ) {
    const reason = diagnostic.includes(`${marker}NODE_MISSING`)
      ? `Node.js was not found on ${target.host} using "${target.nodePath}".`
      : `Node.js on ${target.host} is older than version 20.`
    return new Error(
      `${reason}\nInstall Node.js 20+ on the remote host, then reconnect. With an existing nvm installation: nvm install --lts. On macOS with Homebrew: brew install node.\nIf Node.js is already installed, set its absolute executable path under Remote runtime. Installation guide: https://nodejs.org/en/download`,
    )
  }
  if (diagnostic.includes(`${marker}GIT_MISSING`)) {
    return new Error(
      `Git was not found on ${target.host}. Install Git on the remote host (Debian/Ubuntu: sudo apt-get install git; macOS: xcode-select --install), then reconnect.`,
    )
  }
  if (diagnostic.includes(`${marker}UNSUPPORTED_OS`)) {
    return new Error('Remote workspaces currently require a Linux or macOS SSH host.')
  }
  return new Error(diagnostic.trim() || 'SSH connection closed.')
}
