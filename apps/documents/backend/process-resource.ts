// Канон: shared/backend/process-resource.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import path from 'node:path'
import {createProcessResource} from 'wenay-common2/server/process'

// The application supplies only its entrypoint and IPC protocol.
export function createProcess(deps: {script: string, env: NodeJS.ProcessEnv}) {
    let crash = false
    const child = createProcessResource({
        command: process.execPath,
        args: ['--import', 'tsx', path.resolve(__dirname, deps.script)],
        cwd: path.resolve(__dirname, '..'),
        env: {...process.env, ...deps.env},
        // Node drain has a 2 s grace period followed by bounded host cleanup.
        ipc: true, startTimeoutMs: 20000, stopTimeoutMs: 5000, tailChars: 12000,
        ready(fact) {
            if (fact.type != 'message') return
            const value = fact.value
            // Раздельные проверки сохраняют сужение типа: value.url должен остаться string.
            if (!value || typeof value != 'object') return
            if (!('type' in value) || value.type != 'ready') return
            if (!('url' in value) || typeof value.url != 'string') return
            return value.url
        },
        shutdown(process) {
            if (crash || !process.connected) process.kill('SIGKILL')
            else process.send('shutdown', function sent(error) {if (error) process.kill('SIGKILL')})
        },
    })
    function stop(force = false) {
        crash ||= force
        return child.close()
    }
    return {ready: child.ready, control: {stop}, view: child.view}
}

export type LocalProcess = ReturnType<typeof createProcess>
