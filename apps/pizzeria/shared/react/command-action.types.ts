import type {ServiceCommandCall} from 'wenay-react2/react'
import type {tClientCommands} from 'wenay-common2/service/client'
import type {tCommandRun} from './command-action'
import type {organizerDefinition} from '../../organizer/service'

// Compile-only contract: callers must retain the command/payload correlation.
export function checkCommandTypes(run:tCommandRun<tClientCommands<typeof organizerDefinition>>) {
    void run('workCheckTask',{id:'task',revision:1,index:0,done:true})
    // @ts-expect-error Unknown command is not part of this service.
    void run('placeOrder',{items:[],address:''})
    // @ts-expect-error Payload from another command must not be accepted.
    void run('workCheckTask',{id:'task',revision:1,status:'doing',beforeId:''})
    // @ts-expect-error A checkbox result is boolean, not text.
    void run('workCheckTask',{id:'task',revision:1,index:0,done:'yes'})
}

export function forwardCommand(call:ServiceCommandCall<tClientCommands<typeof organizerDefinition>>,run:tCommandRun<tClientCommands<typeof organizerDefinition>>) {
    return run(...call)
}
