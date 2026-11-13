// Канон: shared/react/replay-view.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {useStoreReplayMirror, useClientStore} from 'wenay-react2/react'
import {useMemo} from 'react'
import type {StoreReplayRemote} from 'wenay-common2/observe'

// React2 owns replay, errors and remote identity. Only the application's empty/error presentation stays here.
export function useReplayView<T extends object>(remote: StoreReplayRemote | null, initial: () => T) {
    const mirror = useStoreReplayMirror<T>(remote, initial())
    const client = useMemo(() => ({store: mirror.store}), [mirror.store])
    const live = !!remote && mirror.ready && !mirror.error
    const value = useClientStore(live ? client : null)
    return {state: value.state, ready: live && value.ready, error: mirror.error ? String(mirror.error) : ''}
}
