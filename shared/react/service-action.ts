// Канон: shared/react/service-action.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {useAsyncAction} from 'wenay-react2/react'

// Форма приложения получает только успех или отказ; ожидание, ошибки
// и одновременные запуски остаются за библиотекой.
export function useServiceAction(key?: unknown) {
    const controller = useAsyncAction({key})
    async function action(run: () => Promise<unknown>) {
        try {
            await controller.run(run)
            return true
        } catch {
            return false
        }
    }
    const error = controller.error
    let message = ''
    if (error instanceof Error) message = error.message
    else if (error) message = String(error)
    return {busy: controller.pending, error: message, action, clearError: controller.clearError}
}
