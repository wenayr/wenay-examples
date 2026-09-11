// Канон: shared/react/command-action.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {useServiceCommands, type ServiceCommandCall, type ServiceCommandMap} from 'wenay-react2/react'

export type tCommandCall<C extends ServiceCommandMap> = ServiceCommandCall<C>
export type tCommandRun<C extends ServiceCommandMap> = (...args: ServiceCommandCall<C>) => Promise<boolean>

export function useCommandAction<C extends ServiceCommandMap>(commands: C | null | undefined) {
    const controller = useServiceCommands(commands)
    async function execute(...call: ServiceCommandCall<C>) {
        return controller.runTuple(call)
    }
    async function run(...args: ServiceCommandCall<C>) {
        try {
            await controller.runTuple(args)
            return true
        } catch {
            return false
        }
    }
    const error = controller.error
    let message = ''
    if (error instanceof Error) message = error.message
    else if (error) message = String(error)
    return {execute, run, busy: controller.pending, error: message, clearError: controller.clearError}
}
