// Канон: shared/react/service-action.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {useAsyncAction} from 'wenay-react2/react'

// Product forms consume success/failure; the library owns pending, errors and concurrency.
export function useServiceAction(key?:unknown) {
    const controller=useAsyncAction({key})
    async function action(run:()=>Promise<unknown>) {
        try {await controller.run(run);return true}
        catch {return false}
    }
    const error=controller.error
    return {busy:controller.pending,error:error instanceof Error?error.message:error?String(error):'',action,clearError:controller.clearError}
}
