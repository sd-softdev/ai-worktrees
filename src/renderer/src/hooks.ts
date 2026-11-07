import { useEffect } from 'react'
import { useApp } from './store'

export function useHookPolling(): void {
  const session = useApp((state) => state.workspaceSession)
  const running = useApp((state) =>
    Object.values(state.workspace?.hookRuns ?? {}).some((run) => run.status === 'running'),
  )
  const connection = useApp((state) => state.remoteStatus?.state)
  useEffect(() => {
    if (!running || connection === 'disconnected') return
    let stopped = false
    let pending = false
    const poll = async () => {
      const app = useApp.getState()
      if (pending || !app.workspace) return
      pending = true
      try {
        const runs = await window.desktop.getHookRuns(app.workspace.id)
        if (!stopped && useApp.getState().workspaceSession === session)
          app.updateHookRuns(app.workspace.id, runs)
      } catch {
        // Reconnect/regular workspace refresh handles transport errors.
      } finally {
        pending = false
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 500)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [session, running, connection])
}
