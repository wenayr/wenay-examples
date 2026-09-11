import React,{useRef,useState,useEffect} from 'react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {GroupingResult,Group} from '../backend/grouping-resource'
import type {Submission} from '../backend/model'
import {useServiceAction} from '../shared/react/service-action'
import {useReplayView} from '../shared/react/replay-view'
import {useFormResource,type Resources,type Organization,type FormRow,type Detail} from './contracts'

export function Grouping({resources,org,row,detail,version,entries}:{resources:Resources,org:Organization,row:FormRow,detail:Detail,version:number,entries:Submission[]}) {
    const remote=useFormResource(resources,'grouping'),action=useServiceAction(remote)
    const replay=useReplayView<AiRunStore>(remote?.ai.state??null,()=>({runs:{},approvals:{},inputs:{}}))
    const publication=detail.versions.find(value=>value.version==(version||row.publishedVersion))
    const fields=publication?.fields.filter(field=>['text','longtext'].includes(field.kind))??[]
    const [fieldId,setFieldId]=useState('')
    const field=fields.find(field=>field.id==fieldId)??fields[0]
    const key=[org.id,row.id,row.answersRevision,publication?.version,field?.id].join(':')
    const current=useRef({remote,key});current.current={remote,key}
    useEffect(()=>()=>{current.current={remote:null,key:''}},[])
    const [loaded,setLoaded]=useState<{remote:typeof remote,key:string,result:GroupingResult,runId:string,groups:Group[]}|null>(null)
    const value=loaded&&loaded.remote==remote&&loaded.key==key?loaded:null
    const run=Object.values(replay.state?.runs??{}).filter(run=>run.resourceIds.includes(row.id)).sort((a,b)=>b.createdAt-a.createdAt)[0]
    const active=run&&['queued','running'].includes(run.state)
    async function start(){setLoaded(null);if(remote&&field&&publication)await action.action(()=>remote.ai.createRun({requestId:crypto.randomUUID(),kind:'group',resourceIds:[row.id],input:{orgId:org.id,formId:row.id,version:publication.version,answersRevision:row.answersRevision,fieldId:field.id}}))}
    async function read(){const scope=current.current;if(scope.remote&&run)await action.action(async()=>{const result=await scope.remote!.control.result(run.id);if(current.current.remote==scope.remote&&current.current.key==scope.key&&result.version==publication?.version&&result.fieldId==field?.id)setLoaded({remote:scope.remote,key:scope.key,result,runId:run.id,groups:result.groups.map(group=>({...group,sourceIds:[...group.sourceIds]}))})})}
    async function save(){const scope=current.current;if(scope.remote&&value)await action.action(async()=>{await scope.remote!.control.correct({runId:value.runId,revision:value.result.revision,groups:value.groups.filter(group=>group.sourceIds.length)});const result=await scope.remote!.control.result(value.runId);if(current.current.remote==scope.remote&&current.current.key==scope.key)setLoaded({...value,result,groups:result.groups.map(group=>({...group,sourceIds:[...group.sourceIds]}))})})}
    function change(groups:Group[]){if(value)setLoaded({...value,groups})}
    return <section className="panel grouping"><header><div><h2>Какие темы повторяются?</h2><p>Тестовая группировка, без платной модели. От 3 до 200 непустых текстовых ответов одной версии. Это небольшой образец, а не статистический вывод.</p></div></header>{field?<><div className="actions"><label>Текстовый вопрос · v{publication?.version}<select value={field.id} onChange={event=>setFieldId(event.target.value)}>{fields.map(field=><option key={field.id} value={field.id}>{field.label}</option>)}</select></label><button disabled={!remote||!replay.ready||action.busy||!!active} onClick={()=>void start()}>Сгруппировать ответы</button>{active&&<button disabled={action.busy} onClick={()=>void action.action(()=>remote!.ai.cancelRun(run!.id))}>Отменить группировку</button>}{run?.state=='completed'&&<button disabled={action.busy} onClick={()=>void read()}>Проверить группы</button>}</div>{(action.error||replay.error)&&<p role="alert" className="error">{action.error||replay.error}</p>}{run?.state=='failed'&&<p>Для группировки нужны от 3 до 200 актуальных непустых ответов. Проверьте вопрос и версию.</p>}{value&&<><p>Ответов в выборке: {value.result.sampleSize}. Названия можно уточнить; исходные ответы останутся прежними.</p><>{org.role!='analyst'&&<button disabled={action.busy||value.groups.length>=20} onClick={()=>change([...value.groups,{label:'Новая тема '+(value.groups.length+1),sourceIds:[]}])}>+ Новая тема</button>}</><div className="group-grid">{value.groups.map((group,index)=><article key={index}><label>Название темы<input value={group.label} disabled={org.role=='analyst'||action.busy} onChange={event=>change(value.groups.map((item,i)=>i==index?{...item,label:event.target.value}:item))}/></label><small>{group.sourceIds.length} ответов</small>{group.sourceIds.map(id=>{const entry=entries.find(entry=>entry.id==id);return <div className="group-source" key={id}><p>{entry?String(entry.answers[field.id]??''):'Ответ с другой страницы списка'}</p>{org.role!='analyst'&&<select aria-label={'Тема ответа '+id.slice(0,6)} value={index} disabled={action.busy} onChange={event=>{const target=Number(event.target.value);change(value.groups.map((item,i)=>({...item,sourceIds:i==index?item.sourceIds.filter(value=>value!=id):i==target?[...item.sourceIds,id]:item.sourceIds})))}}>{value.groups.map((item,i)=><option key={i} value={i}>{item.label}</option>)}</select>}</div>})}</article>)}</div>{org.role!='analyst'&&<button className="primary" disabled={action.busy} onClick={()=>void save()}>Сохранить уточнение тем</button>}</>}</>:<p>В этой публикации нет текстовых вопросов. Выберите другую версию.</p>}</section>
}


