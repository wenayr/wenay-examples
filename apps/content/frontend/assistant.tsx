import React,{useRef,useEffect,useState} from 'react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {Page} from '../backend/model'
import type {EditResult} from '../backend/assistant-resource'
import {useServiceAction} from '../shared/react/service-action'
import {useReplayView} from '../shared/react/replay-view'
import {useContentResource,type Resources,type Commands} from './contracts'
export function EditAssistant({resources,commands,page}:{resources:Resources,commands:Commands,page:Page}) {
    const remote=useContentResource(resources,'assistant'),action=useServiceAction(remote)
    const replay=useReplayView<AiRunStore>(remote?.ai.state??null,()=>({runs:{},approvals:{},inputs:{}}))
    const [blockId,setBlockId]=useState(''),[instruction,setInstruction]=useState('Уберите лишние пробелы и проверьте начало предложения.')
    const blocks=page.draft.blocks.filter(block=>['heading','text','quote'].includes(block.kind)),block=blocks.find(block=>block.id==blockId)??blocks[0]
    const key=page.id+':'+page.revision+':'+block?.id
    const current=useRef({remote,key});current.current={remote,key}
    useEffect(()=>()=>{current.current={remote:null,key:''}},[])
    const [loaded,setLoaded]=useState<{remote:typeof remote,key:string,result:EditResult,runId:string}|null>(null)
    const value=loaded&&loaded.remote==remote&&loaded.key==key?loaded:null
    const run=Object.values(replay.state?.runs??{}).filter(run=>run.resourceIds.includes(page.id)).sort((a,b)=>b.createdAt-a.createdAt)[0]
    const active=run&&['queued','running'].includes(run.state)
    async function prepare(event:React.FormEvent){event.preventDefault();setLoaded(null);if(remote&&block)await action.action(()=>remote.ai.createRun({requestId:crypto.randomUUID(),kind:'edit',resourceIds:[page.id],input:{orgId:page.orgId,id:page.id,revision:page.revision,blockId:block.id,instruction}}))}
    async function read(){const scope=current.current;if(scope.remote&&run)await action.action(async()=>{const result=await scope.remote!.control.result(run.id);if(current.current.remote==scope.remote&&current.current.key==scope.key&&result.blockId==block?.id)setLoaded({remote:scope.remote,key:scope.key,result,runId:run.id})})}
    async function accept(){const scope=current.current;if(scope.remote&&value)await action.action(async()=>{const result=await scope.remote!.control.result(value.runId);if(current.current.remote!=scope.remote||current.current.key!=scope.key)return;const ok=await commands.run('pageSave',{orgId:page.orgId,id:page.id,revision:result.revision,...page.draft,blocks:page.draft.blocks.map(block=>block.id==result.blockId?{...block,text:result.after}:block)});if(ok)setLoaded(null)})}
    return <section className="assistant-panel"><header><span>✧</span><div><h2>Взгляд со стороны</h2><p>Демонстрационный помощник убирает лишние пробелы и исправляет первую букву. Это не языковая модель; платных запросов нет.</p></div></header><form onSubmit={prepare}><label>Сохранённый текстовый блок<select value={block?.id??''} onChange={event=>setBlockId(event.target.value)}>{blocks.map(block=><option key={block.id} value={block.id}>{block.text.slice(0,75)}</option>)}</select></label><label>Пожелание к тексту<textarea value={instruction} onChange={event=>setInstruction(event.target.value)} maxLength={1000} rows={2}/></label><div className="actions"><button disabled={!remote||!replay.ready||!block||action.busy||!!active}>Подготовить вариант</button>{active&&<button type="button" disabled={action.busy} onClick={()=>void action.action(()=>remote!.ai.cancelRun(run!.id))}>Отменить подготовку</button>}{run?.state=='completed'&&<button type="button" disabled={action.busy} onClick={()=>void read()}>Проверить предложение</button>}</div></form>{(action.error||replay.error)&&<p className="error" role="alert">{action.error||replay.error}</p>}{value&&<div className="edit-comparison"><div><small>СЕЙЧАС · Сохранённый блок</small><p>{value.result.before}</p></div><div><small>ПРЕДЛАГАЕТСЯ · Тестовая правка</small><p>{value.result.after}</p></div><small>Источник: «{value.result.title}», ревизия {value.result.revision}. Изменится только выбранный блок.</small><div className="actions"><button className="primary" disabled={action.busy||commands.busy} onClick={()=>void accept()}>Принять в черновик</button><button onClick={()=>setLoaded(null)}>Отклонить</button></div></div>}</section>
}
