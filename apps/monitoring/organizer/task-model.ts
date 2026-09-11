export const WORK_COLUMNS = [{key:'todo',title:'Запланировано'},{key:'doing',title:'В работе'},{key:'done',title:'Готово'}] as const
export type tWorkStatus = typeof WORK_COLUMNS[number]['key']
export type WorkTask = {
    id:string, title:string, description:string, assignee:string, createdBy:string,
    status:tWorkStatus, due:string, priority:'normal'|'high', revision:number,
    source?:{kind:'order'|'stock'|'ticket'|'deal'|'incident',id:string,label:string}, automatic?:boolean, audience?:string[],
    checklist?:{title:string,done:boolean}[], completedAt?:number, completedBy?:string,
}
export type TaskState = {tasks: Record<string, WorkTask>, columns: Record<tWorkStatus, string[]>}

