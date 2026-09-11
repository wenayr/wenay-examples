import {WORK_COLUMNS, type WorkTask, type tWorkStatus} from './task-model'
export {WORK_COLUMNS, type WorkTask, type tWorkStatus} from './task-model'
export type WorkProfile = {position:string, note:string}
export type WorkState = {
    proposals?: Record<string, {ids: string[], signature: string}>,
    canvas?: CanvasState,
    tasks:Record<string,WorkTask>, columns:Record<tWorkStatus,string[]>, profiles:Record<string,WorkProfile>,
}
export function emptyWork():WorkState {
    return {tasks:{},columns:{todo:[],doing:[],done:[]},profiles:{}}
}
export type WorkPerson = {account:string,name:string,roles:string[],position:string,note:string,canManage:boolean}
export type Workload = {
    queue:{orders:number,dishes:number},
    people:{account:string,orders:number,dishes:number,oldestStartedAt:number|null}[],
}
export type WorkView = {
    canvas?: CanvasState,
    tasks:Record<string,WorkTask>, columns:{key:string,items:string[]}[], people:WorkPerson[],
    me:string, manage:boolean, owner:boolean, roleOptions:{id:string,title:string}[],
    sources:{id:string,label:string}[],
    workload?:Workload,
}
import type {CanvasState} from './canvas-model'

