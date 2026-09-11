// Канон: shared/react/service-session.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {useMemo,useState} from 'react'
import {useClientStore,useOwnedClient} from 'wenay-react2/react'
import {createServiceClient,type ServiceClientDefinition} from 'wenay-common2/service/client'
import type {tServiceDefinition} from 'wenay-common2/service'

export function useServiceSession<D extends tServiceDefinition<any,any>>(deps:{url:string,storageKey:string,anonymous?:boolean}) {
    const {url,storageKey,anonymous=false}=deps
    const [auth,setAuth]=useState(()=>({storageKey,token:sessionStorage.getItem(storageKey) ?? ''}))
    const token=auth.storageKey==storageKey?auth.token:sessionStorage.getItem(storageKey) ?? ''
    const [epoch,setEpoch]=useState(0)
    const key=JSON.stringify([url,storageKey,token,epoch,anonymous])
    const [renewed,setRenewed]=useState({key:'',token:''})
    const [dismissed,setDismissed]=useState<unknown>(null)
    const owned=useOwnedClient({key,enabled:!!token||anonymous,create:async function create(signal) {
        const response=await fetch(url+'/api/client',{signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])})
        if (!response.ok) throw new Error('Сервис недоступен')
        const definition:ServiceClientDefinition<D>=await response.json()
        signal.throwIfAborted()
        const latest=token?sessionStorage.getItem(storageKey) ?? token:''
        return createServiceClient<D>({definition,url,...(latest?{auth:{token:latest}}:{}),onToken:function renew(value) {
            if (signal.aborted) return
            sessionStorage.setItem(storageKey,value)
            setRenewed({key,token:value})
        }})
    }})
    const session=owned.ready?owned.client:null
    const health=useClientStore(useMemo(()=>session?{store:session.health}:null,[session]))
    const permissions=useClientStore(useMemo(()=>session?{store:session.identity.permissions}:null,[session]))
    const me=permissions.state?.account?{...permissions.state,account:permissions.state.account}:null
    function setToken(value:string) {
        if (value) sessionStorage.setItem(storageKey,value)
        else sessionStorage.removeItem(storageKey)
        setAuth({storageKey,token:value})
        setEpoch(value=>value+1)
    }
    function dismissError() {setDismissed(owned.error)}
    const error=owned.error&&owned.error!=dismissed?owned.error:null
    return {session,me,token,setToken,liveToken:renewed.key==key?renewed.token:token,
        connected:health.state?.connected ?? false,error:error instanceof Error?error.message:error?String(error):'',dismissError}
}
