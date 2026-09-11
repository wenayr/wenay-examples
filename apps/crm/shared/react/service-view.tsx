// Канон: shared/react/service-view.tsx. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import React from 'react'
import {useClientStore, type StoreBackedClient} from 'wenay-react2/react'

type ViewProps<T extends object> = {
    remote: StoreBackedClient<T>,
    initial: T,
    children: (value: T) => React.ReactNode
}

// Только представление: подписку и защиту от устаревшего ready держит библиотека.
export function ServiceView<T extends object>({remote, initial, children}: ViewProps<T>) {
    const {state, ready, error} = useClientStore(remote)
    if (error) return <p role="alert">Поток недоступен. Обновите страницу или войдите снова.</p>
    const complete = state != null && Object.keys(initial).every(key => Object.hasOwn(state, key))
    if (!ready || !complete) return <p className="empty">Загружаем свежие данные…</p>
    return <>{children(state)}</>
}
