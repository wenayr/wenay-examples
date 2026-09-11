import {createOrganizer,type WorkHost} from './domain'
import {emptyWork} from './model'
import {hashSecret,verifySecret} from '../backend/identity'
import type {tServiceDefinition} from 'wenay-common2/service'
import {createBoardRoom} from './collaboration-resource'
import {emptyCanvas} from './canvas-model'
import {createScreenRoom} from './screen-resource'
import {createChatRoom} from './chat-resource'
import type {AssistantProvider} from './assistant-resource'

const workModule = createOrganizer<WorkHost>({staffRoles:['member','manager','owner'],roleOptions:[{id:'member',title:'Сотрудник'},{id:'manager',title:'Менеджер'},{id:'owner',title:'Владелец'}]})
const baseDefinition = {
    name:'organizer',storeId:'organizer-store',originId:'organizer-origin',version:2,
    migrate(state: WorkHost) {return {...state, organizer: {...state.organizer, canvas: state.organizer.canvas ?? emptyCanvas()}}},
    initial:{organizer:emptyWork(),accounts:Object.fromEntries([
        ['owner','Владелец',['owner']],['manager','Менеджер',['manager']],['worker','Сотрудник',['member']],
    ].map(([account,name,roles])=>[String(account),{account:String(account),name:String(name),phone:'',roles:roles as string[],secret:hashSecret(account+'-pass')}]))} as WorkHost,
    access:{rolesOf:(state:WorkHost,account:string)=>state.accounts[account]?.roles ?? [],
        login:{input:{account:'string',password:'string'},resolve(state:WorkHost,input:{account:string,password:string}) {return verifySecret(state.accounts[input.account]?.secret,input.password)?input.account:null}},
    },
    ...workModule,
} satisfies tServiceDefinition<WorkHost>

export function createOrganizerService(deps: {directory?: string, provider?: AssistantProvider} = {}) {
    const room = createBoardRoom({allow: workModule.views.work.allow})
    const screen = createScreenRoom({allow: workModule.views.work.allow})
    const chat = createChatRoom({allow: workModule.views.work.allow, directory: deps.directory, provider: deps.provider})
    return {definition: {...baseDefinition, resources: {board: room.resource, screen: screen.resource, chat: chat.resource}},
        mount(store: Parameters<typeof room.mount<WorkHost>>[0]['store']) {
            const closeBoard = room.mount({store, project: workModule.views.work.project})
            const closeScreen = screen.mount()
            const closeChat = chat.mount({store, project: workModule.views.work.project, principal: (state, account) => ({account, roles: state.accounts[account]?.roles ?? []})})
            return function close() {closeChat(); closeScreen(); closeBoard()}
        }}
}
export const organizerDefinition = createOrganizerService().definition
