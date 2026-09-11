import React from 'react'
import {useClientStore, type StoreBackedClient} from 'wenay-react2/react'

// Presentation only: the library owns the subscription and stale-ready guard.
export function ServiceView<T extends object>({remote,initial,children}:{remote:StoreBackedClient<T>,initial:T,children:(value:T)=>React.ReactNode}) {
    const {state,ready,error}=useClientStore(remote)
    if (error) return <p role="alert">Поток недоступен. Обновите страницу или войдите снова.</p>
    const complete=state!=null&&Object.keys(initial).every(key=>Object.hasOwn(state,key))
    return ready&&complete?<>{children(state)}</>:<p className="empty">Загружаем свежие данные…</p>
}
