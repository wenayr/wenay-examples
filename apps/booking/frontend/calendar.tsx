import {PreferenceAssistant} from './assistant'
import React,{useEffect,useMemo,useRef,useState} from 'react'
import {Temporal} from '@js-temporal/polyfill'
import {useClientStore,useOwnedClient} from 'wenay-react2/react'
import type {BookingWorkspace} from '../backend/domain'
import {useServiceAction} from '../shared/react/service-action'
import {when,clock,type Commands,type Resources,type Organization} from './contracts'

function openCalendar(resources:Resources){return resources.open('calendar')}
type CalendarRemote=NonNullable<ReturnType<ReturnType<typeof openCalendar>['current']>>['remote']
type Availability=Awaited<ReturnType<CalendarRemote['control']['read']>>

export function Calendar({value,org,resources,commands,busy,moving,done}:{value:BookingWorkspace,org:Organization,resources:Resources,commands:Commands,busy:boolean,moving:string,done:()=>void}) {
    const owned=useOwnedClient({key:resources,create:()=>({...openCalendar(resources),ready:Promise.resolve()})})
    const status=useClientStore(useMemo(()=>owned.client?{store:owned.client.status}:null,[owned.client]))
    const remote=status.state?.phase=='ready'?owned.client?.current()?.remote:null
    const action=useServiceAction(remote)
    const booking=value.bookings.find(item=>item.id==moving&&item.orgId==org.id)
    const services=value.services.filter(item=>item.orgId==org.id&&item.active)
    const [serviceId,setServiceId]=useState(booking?.serviceId??services[0]?.id??'')
    const service=services.find(item=>item.id==serviceId)??services[0]
    const resource=value.resources.find(item=>item.id==service?.resourceId)
    const zone=resource?.zone??'UTC'
    const [from,setFrom]=useState(()=>Temporal.Now.zonedDateTimeISO(zone).toPlainDate().add({days:1}).toString())
    const [days,setDays]=useState(7)
    const [partySize,setPartySize]=useState(booking?.partySize??1)
    const [selected,setSelected]=useState<number|null>(null)
    const [refresh,setRefresh]=useState(0)
    const [loaded,setLoaded]=useState<{key:string,remote:CalendarRemote,result:Availability}|null>(null)
    const [error,setError]=useState('')
    const changes=JSON.stringify(value.bookings.filter(item=>item.orgId==org.id).map(item=>[item.id,item.revision]))
    const key=JSON.stringify([org.id,service?.id,service?.revision,resource?.revision,from,days,partySize,changes,refresh])
    const current=useRef({key,remote})
    current.current={key,remote}
    const intent=useRef<{signature:string,key:string}|null>(null)
    useEffect(function readAvailability(){let active=true;setError('');if(remote&&service)void remote.control.read({orgId:org.id,serviceId:service.id,from,days,partySize}).then(result=>{if(active&&current.current.key==key&&current.current.remote==remote)setLoaded({key,remote,result})},error=>{if(active)setError(error instanceof Error?error.message:'Время недоступно')});return()=>{active=false}},[key,remote])
    const calendar=loaded?.key==key&&loaded.remote==remote?loaded.result:null
    const slot=calendar?.slots.find(item=>item.start==selected)
    const disabled=busy||action.busy||!remote||!calendar
    function intentKey(signature:string){if(intent.current?.signature!=signature)intent.current={signature,key:crypto.randomUUID()};return intent.current.key}
    async function reserve(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(!service||!slot)return;const form=new FormData(event.currentTarget);let ok=false
        if(booking){const input={orgId:org.id,id:booking.id,revision:booking.revision,start:slot.start};ok=await commands.run('bookingMove',{...input,key:intentKey('move'+JSON.stringify(input))})}
        else{const input={orgId:org.id,serviceId:service.id,start:slot.start,partySize,customer:String(form.get('customer')??''),note:String(form.get('note')??''),reminder:form.get('reminder')=='on'};ok=await commands.run('bookingHold',{...input,key:intentKey('hold'+JSON.stringify(input))})}
        if(ok){intent.current=null;done()}else setRefresh(item=>item+1)
    }
    async function wait(){if(!service||!slot)return;const input={orgId:org.id,serviceId:service.id,start:slot.start,partySize};if(await commands.run('waitJoin',{...input,key:intentKey('wait'+JSON.stringify(input))})){intent.current=null;done()}}
    const calendarDays=Array.from({length:days},(_,index)=>Temporal.PlainDate.from(from).add({days:index}).toString())
    return <><div className="page-heading"><div><p className="eyebrow">{booking?'ПЛАНЫ МОГУТ МЕНЯТЬСЯ':'ВСТРЕТИМСЯ В УДОБНОЕ ВРЕМЯ'}</p><h1>{booking?'Выберите новое время':'Немного времени для себя.'}</h1><p>{booking?'Текущая запись сохранится, если новое время уже занято.':'Выберите услугу и время. Мы ненадолго удержим его для подтверждения.'}</p></div><span className="zone-badge">◷ {zone}</span></div>
        <div className="booking-layout"><aside className="service-rail"><h2>На какую встречу?</h2>{services.map(item=><button className={'service-option '+(service?.id==item.id?'selected':'')} key={item.id} disabled={!!booking} onClick={()=>{setServiceId(item.id);setSelected(null);setPartySize(1)}}><span className="service-symbol">◒</span><strong>{item.name}</strong><p>{item.description}</p><small>{item.duration} мин · {value.resources.find(resource=>resource.id==item.resourceId)?.name}</small><span className="service-price">{item.depositUnits?'Тестовая предоплата '+item.depositUnits+' ед.':'Без предоплаты'}</span></button>)}{!services.length&&<p>Активных услуг пока нет.</p>}<div className="gentle-note"><span>☀</span><p>Время показано в часовом поясе места встречи. При переводе часов рядом указан UTC-сдвиг.</p></div></aside>
        <section className="calendar-panel">{!booking&&<PreferenceAssistant resources={resources} orgId={org.id} busy={busy} catalogKey={JSON.stringify([services.map(item=>[item.id,item.revision]),value.resources.filter(item=>item.orgId==org.id).map(item=>[item.id,item.revision])])} apply={result=>{setServiceId(result.serviceId);setFrom(result.date);setPartySize(result.partySize);setSelected(null);setDays(1);setRefresh(item=>item+1)}}/>}<div className="calendar-toolbar"><div><button aria-label="Предыдущий период" onClick={()=>{setFrom(Temporal.PlainDate.from(from).subtract({days}).toString());setSelected(null)}}>‹</button><input type="date" aria-label="Начало периода" value={from} onChange={event=>{if(event.target.value){setFrom(event.target.value);setSelected(null)}}}/><button aria-label="Следующий период" onClick={()=>{setFrom(Temporal.PlainDate.from(from).add({days}).toString());setSelected(null)}}>›</button></div><div className="segmented"><button aria-pressed={days==1} onClick={()=>setDays(1)}>День</button><button aria-pressed={days==7} onClick={()=>setDays(7)}>Неделя</button></div><label>Участников<input type="number" min="1" max={service?.capacity??1} value={partySize} disabled={!!booking} onChange={event=>{setPartySize(Number(event.target.value));setSelected(null)}}/></label><button aria-label="Обновить доступное время" disabled={busy} onClick={()=>setRefresh(item=>item+1)}>↻</button></div>
            {(error||action.error)&&<p className="inline-error" role="alert">{error||action.error}</p>}{!calendar?<div className="empty">Проверяем свободное время…</div>:<><div className={'calendar-days '+(days==1?'single':'')}>{calendarDays.map(day=>{const slots=calendar.slots.filter(item=>item.local.slice(0,10)==day);const date=Temporal.PlainDate.from(day);return <section key={day}><header><span>{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][date.dayOfWeek-1]}</span><strong>{date.day}</strong><small>{new Intl.DateTimeFormat('ru',{month:'short',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'))}</small></header><div className="time-slots">{slots.map(item=><button key={item.start} className={(item.available?'':'occupied ')+(selected==item.start?'selected':'')} aria-pressed={selected==item.start} aria-label={when(item.start,zone)+(item.available?' · свободно':' · занято')} disabled={busy} onClick={()=>setSelected(item.start)}><strong>{clock(item.start,zone)}</strong><small>{item.offset} · {item.available?'свободно':'лист ожидания'}</small></button>)}{!slots.length&&<p>Нет времени<br/>для записи</p>}</div></section>})}</div>{calendar.truncated&&<p className="muted">Показана часть доступного времени. Сузьте период до одного дня.</p>}<p className="calendar-caption">Свободное время проверяется снова при записи. Занятый слот можно добавить в лист ожидания.</p></>}
            {slot&&service&&<form className="reservation-summary" onSubmit={reserve}><div><p className="eyebrow">{booking?'НОВОЕ ВРЕМЯ':'ВАША ВСТРЕЧА'}</p><h2>{service.name}</h2><strong>{when(slot.start,zone)}</strong><p>{service.duration} минут · {resource?.name}</p></div>{!booking&&<><label>Комментарий специалисту<textarea name="note" rows={2} maxLength={1000} placeholder="Что важно знать перед встречей?"/></label>{org.role!='customer'&&<label>Записать клиента<select name="customer"><option value="">Записаться самому</option>{value.people.filter(item=>item.orgId==org.id&&item.role=='customer').map(item=><option key={item.account} value={item.account}>{item.name}</option>)}</select></label>}<label className="inline"><input type="checkbox" name="reminder" defaultChecked/>Напомнить в локальной тестовой почте</label></>}{slot.available>0?<button className="primary" disabled={disabled}>{booking?'Подтвердить перенос':'Удержать время и продолжить →'}</button>:<><p>Сейчас это время занято. Мы предложим его, если место освободится.</p><button type="button" disabled={disabled||!!booking} onClick={()=>void wait()}>Встать в лист ожидания</button></>}{!booking&&<small>Удержание действует несколько минут. Запись нужно подтвердить в разделе встреч.</small>}</form>}
        </section></div></>
}
