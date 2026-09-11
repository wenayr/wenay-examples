import {useServiceCommands,type ServiceCommandCall,type ServiceCommandMap} from 'wenay-react2/react'

export type tCommandCall<C extends ServiceCommandMap> = ServiceCommandCall<C>
export type tCommandRun<C extends ServiceCommandMap> = (...args:ServiceCommandCall<C>)=>Promise<boolean>

export function useCommandAction<C extends ServiceCommandMap>(commands:C|null|undefined) {
    const controller=useServiceCommands(commands)
    async function execute(...call:ServiceCommandCall<C>) {return controller.runTuple(call)}
    async function run(...args:ServiceCommandCall<C>) {
        try {await controller.runTuple(args);return true}
        catch {return false}
    }
    const error=controller.error
    return {execute,run,busy:controller.pending,error:error instanceof Error?error.message:error?String(error):'',clearError:controller.clearError}
}
