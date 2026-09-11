import {Overlay} from 'wenay-react2/ui'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useClientStore, useOwnedClient, useReorderBoard} from 'wenay-react2/react'
import {AgGridTable, useAgGrid, useAgGridTheme} from 'wenay-react2/grid'
import type {ColDef} from 'ag-grid-community'
import type {CrmWorkspace} from '../backend/domain'
import type {tStage} from '../backend/model'
import {useServiceAction} from '../shared/react/service-action'
import {DealPanel, DealForm} from './detail'
import {stages, money, date, download, type Commands, type Resources, type Organization, type DealRow} from './contracts'

export function Deals({value,org,commands,resources,busy}:{value:CrmWorkspace,org:Organization,commands:Commands,resources:Resources,busy:boolean}) {
    const owned = useOwnedClient({key:resources,create:()=>({...resources.open('crm'),ready:Promise.resolve()})})
    const status = useClientStore(useMemo(()=>owned.client?{store:owned.client.status}:null,[owned.client]))
    const remote = status.state?.phase=='ready'?owned.client?.current()?.remote:null
    const action = useServiceAction(remote)
    const [mode,setMode] = useState('board')
    const [query,setQuery] = useState('')
    const [stage,setStage] = useState('all')
    const [archived,setArchived] = useState(false)
    const [selected,setSelected] = useState('')
    const [creating,setCreating] = useState(false)
    const [checked,setChecked] = useState<string[]>([])
    const current = useRef({remote,orgId:org.id})
    current.current = {remote,orgId:org.id}
    useEffect(()=>()=>{current.current={remote:null,orgId:''}},[])
    const staff = org.role!='customer'
    const manager = org.role=='owner'||org.role=='lead'
    const all = value.deals.filter(item=>item.orgId==org.id)
    const rows = all.filter(item=>item.archived==archived&&(stage=='all'||item.stage==stage)&&(item.title+' '+item.description+' '+(value.companies.find(company=>company.id==item.companyId)?.name??'')).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    const selectedRow = all.find(item=>item.id==selected)
    const people = value.people.filter(item=>item.orgId==org.id&&item.role!='customer')
    async function exportData(format:'csv'|'json') {
        const active = current.current
        await action.action(async function exportScope() {
            if (!active.remote) throw new Error('Соединение ещё не готово')
            const file = await active.remote.control.export({orgId:active.orgId,format})
            if (current.current.remote==active.remote&&current.current.orgId==active.orgId) download(file)
        })
    }
    return <><div className="page-title"><div><p className="eyebrow">{staff?'ОТ КОНТАКТА К ДОГОВОРЁННОСТИ':'ВАШИ ПРОЕКТЫ И ПРЕДЛОЖЕНИЯ'}</p><h1>{staff?'Следующий шаг — ближе.':'Давайте договоримся.'}</h1><p>{staff?'Каждая сделка на своём месте. Каждое обещание в контексте.':'Проверяйте предложения и обсуждайте детали с командой.'}</p></div>{staff&&<button className="primary" disabled={busy} onClick={()=>setCreating(true)}>+ Новая сделка</button>}</div>
        <div className="metrics"><div><span>Открытые сделки</span><strong>{all.filter(item=>!item.archived&&!['won','lost'].includes(item.stage)).length}</strong><small>в вашей организации</small></div><div><span>В работе</span><strong>{money(all.filter(item=>!item.archived&&!['won','lost'].includes(item.stage)).reduce((sum,item)=>sum+item.amount,0))}</strong><small>условная стоимость проектов</small></div><div><span>Предложения</span><strong>{all.filter(item=>!item.archived&&item.stage=='proposal').length}</strong><small>на пути к согласованию</small></div><div><span>Договорились</span><strong>{all.filter(item=>!item.archived&&item.proposalDecision=='accept').length}</strong><small>предложений принято</small></div></div>
        <div className="toolbar"><div className="segmented"><button aria-pressed={mode=='board'} onClick={()=>setMode('board')}>▦ Воронка</button><button aria-pressed={mode=='table'} onClick={()=>setMode('table')}>☷ Таблица</button></div><input aria-label="Поиск сделок" placeholder="Найти сделку или компанию…" value={query} onChange={event=>setQuery(event.target.value)}/><select aria-label="Этап сделки" value={stage} onChange={event=>setStage(event.target.value)}><option value="all">Все этапы</option>{Object.entries(stages).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><label className="inline"><input type="checkbox" checked={archived} onChange={event=>setArchived(event.target.checked)}/>Архив</label>{staff&&<><button disabled={!remote||action.busy} onClick={()=>void exportData('csv')}>CSV ↓</button><button disabled={!remote||action.busy} onClick={()=>void exportData('json')}>JSON ↓</button></>}</div>
        {action.error&&<p className="error-inline" role="alert">{action.error}</p>}
        {manager&&mode=='table'&&<form className="batch" onSubmit={event=>{event.preventDefault();const assignee=String(new FormData(event.currentTarget).get('assignee'));void commands.run('batchAssign',{orgId:org.id,items:rows.filter(item=>checked.includes(item.id)).map(({id,revision})=>({id,revision})),assignee})}}><span>Выбрано: {rows.filter(item=>checked.includes(item.id)).length}</span><select name="assignee" aria-label="Назначить выбранные сделки">{people.map(item=><option key={item.account} value={item.account}>{item.name}</option>)}</select><button disabled={busy||!rows.some(item=>checked.includes(item.id))||archived}>Назначить</button></form>}
        {mode=='board'&&!archived?<Funnel value={value} org={org} rows={rows} commands={commands} busy={busy} onOpen={setSelected}/>:<DealTable rows={rows} companies={value.companies} checked={checked} onChecked={setChecked} select={manager&&!archived} onOpen={setSelected}/>}
        {!rows.length&&<div className="empty"><span>◎</span><h2>Здесь есть место для новых возможностей</h2><p>Измените фильтр или добавьте первую сделку.</p></div>}
        {creating&&<Overlay scrimClassName="modal-backdrop" outsideClassName="modal" ariaLabel="Новая сделка" onEscape={()=>setCreating(false)}><DealForm value={value} org={org} commands={commands} busy={busy} onClose={()=>setCreating(false)}/></Overlay>}
        {selectedRow&&<DealPanel key={selectedRow.id+':'+org.role} row={selectedRow} value={value} org={org} remote={remote??null} resources={resources} commands={commands} busy={busy} close={()=>setSelected('')}/>}
    </>
}

function Funnel({value,org,rows,commands,busy,onOpen}:{value:CrmWorkspace,org:Organization,rows:DealRow[],commands:Commands,busy:boolean,onOpen:(id:string)=>void}) {
    const byId = Object.fromEntries(rows.map(item=>[item.id,item]))
    const columns = (value.columns.find(item=>item.orgId==org.id)?.stages??[]).map(item=>({...item,items:item.items.filter(id=>!!byId[id])}))
    const grab = useRef<{id:string,revision:number}|null>(null)
    const board = useReorderBoard({columns,canDrag:id=>!busy&&org.role!='customer'&&(org.role!='manager'||byId[id]?.assignee==value.me?.account),
        onDragStart({key}) {grab.current={id:key,revision:byId[key].revision}},
        commit(next) {const item=grab.current;if(!item)return;const column=next.find(part=>part.items.includes(item.id));if(!column)return;void commands.run('dealMove',{orgId:org.id,...item,stage:column.key as tStage,beforeId:column.items[column.items.indexOf(item.id)+1]??'',reason:''})}})
    useEffect(function cancelStale() {if(board.dragKey&&grab.current&&(busy||byId[grab.current.id]?.revision!=grab.current.revision))board.cancel()},[busy,rows,board.dragKey])
    return <><p className="drag-hint">{org.role=='customer'?'Откройте карточку, чтобы посмотреть предложение.':'Переносите за ручку: мышь или пробел → стрелки → Enter. Закрытие с причиной доступно в карточке.'}</p><div className="funnel">{columns.map(column=><section className={'stage '+column.key} key={column.key}><header><i/><h2>{stages[column.key]}</h2><span>{column.items.length}</span></header><div className="stage-items" ref={board.columnRef(column.key)}>{column.items.map(id=>{const item=byId[id],drag=board.item(id);return <article key={id} style={drag.style} className="deal-card">{org.role!='customer'&&<button {...drag.handleProps} className="grip" aria-label={'Переместить '+item.title}>⋮⋮</button>}<span className="company-label">{value.companies.find(company=>company.id==item.companyId)?.name??'Ваш проект'}</span><button className="deal-title" onClick={()=>onOpen(id)}>{item.title}</button><strong className="deal-amount">{money(item.amount)}</strong>{item.proposalVersion>0&&<span className={'proposal-tag '+(item.proposalDecision??'')}>{item.proposalDecision=='accept'?'✓ Принято':item.proposalDecision=='changes'?'Нужны изменения':'Предложение v'+item.proposalVersion}</span>}<footer><span className="avatar small">{value.people.find(person=>person.account==item.assignee)?.name.slice(0,1)??'?'}</span><span>{value.people.find(person=>person.account==item.assignee)?.name.split(' · ')[0]??item.assignee}</span><time>{date(item.updatedAt).split(',')[0]}</time></footer></article>})}</div></section>)}</div><p className="sr-only" aria-live="polite">{board.over?'Перенос: '+stages[board.over.col as tStage]:''}</p></>
}

function DealTable({rows,companies,checked,onChecked,select,onOpen}:{rows:DealRow[],companies:CrmWorkspace['companies'],checked:string[],onChecked:(value:string[])=>void,select:boolean,onOpen:(id:string)=>void}) {
    const grid = useAgGrid<DealRow>({getId:row=>row.id!,mode:'overlay'})
    const theme = useAgGridTheme('light')
    const columns = useMemo<ColDef<DealRow>[]>(()=>[
        ...(select?[{colId:'select',headerName:'',width:55,minWidth:55,maxWidth:55,sortable:false,filter:false,cellRenderer:({data}:{data:DealRow})=><input type="checkbox" aria-label={'Выбрать '+data.title} checked={checked.includes(data.id)} onChange={event=>onChecked(event.target.checked?[...checked,data.id]:checked.filter(id=>id!=data.id))}/>}]:[]),
        {field:'title',headerName:'Сделка',minWidth:250,flex:2,cellRenderer:({data}:{data:DealRow})=><button className="table-link" onClick={()=>onOpen(data.id)}>{data.title}</button>},
        {field:'companyId',headerName:'Компания',minWidth:160,flex:1,valueFormatter:params=>companies.find(item=>item.id==params.value)?.name??'—'},
        {field:'amount',headerName:'Стоимость',width:160,valueFormatter:params=>money(params.value)},
        {field:'stage',headerName:'Этап',width:150,valueFormatter:params=>stages[params.value as tStage]},
        {field:'assignee',headerName:'Ответственный',width:145},
        {field:'updatedAt',headerName:'Обновлено',width:165,valueFormatter:params=>date(params.value)}
    ],[companies,checked,onChecked,select,onOpen])
    return <div className="deal-grid"><AgGridTable<DealRow> controller={grid} theme={theme} rowData={rows} columnDefs={columns} rowHeight={58} headerHeight={44} suppressCellFocus={false} rowSelection={{mode:'singleRow',checkboxes:false,enableClickSelection:false}}/></div>
}
