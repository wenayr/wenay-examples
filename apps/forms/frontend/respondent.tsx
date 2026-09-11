import React,{useEffect,useRef,useState} from 'react'
import type {FormsDefinition} from '../backend/runtime'
import type {Answers} from '../backend/model'
import {useServiceSession} from '../shared/react/service-session'
import {useServiceAction} from '../shared/react/service-action'
import {useFormResource,type Resources} from './contracts'
import {Questions,cleanAnswers} from './questions'

export async function authenticate(account:string,password:string){const response=await fetch('/api/forms/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args:[{account,password}]})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error?.message??'Ссылка закрыта или недействительна');return String(body.value.token)}
export function Respondent({token}:{token:string}) {
    const connection=useServiceSession<FormsDefinition>({url:location.origin,storageKey:'petal-respondent-session'})
    const action=useServiceAction(token)
    const [authorised,setAuthorised]=useState(false)
    useEffect(()=>{let active=true;setAuthorised(false);void action.action(async()=>{const value=await authenticate('respondent',token);if(active){connection.setToken(value);setAuthorised(true)}});return()=>{active=false}},[token])
    return <main className="respondent"><a href="/" className="public-brand">✳ petal<span>НЕМНОГО ВАШЕГО ВНИМАНИЯ</span></a>{(action.error||connection.error)&&<section className="form-paper"><h1>Опрос сейчас недоступен</h1><p role="alert">{action.error||connection.error}</p><p>Попросите автора прислать новую ссылку.</p></section>}{authorised&&connection.session&&connection.me?.resources?.includes('publicform')?<PublicForm resources={connection.session.resources}/>:authorised&&connection.session?<section className="form-paper"><h1>Ссылка на опрос обновилась</h1><p>Автор закрыл эту публикацию. Попросите новую ссылку, чтобы продолжить.</p></section>:!action.error&&!connection.error?<p>Открываем опрос…</p>:null}<footer>Вопросы помогают услышать друг друга. Сделано в Petal.</footer></main>
}
function PublicForm({resources}:{resources:Resources}) {
    const remote=useFormResource(resources,'publicform')
    type Current=Awaited<ReturnType<NonNullable<typeof remote>['control']['current']>>
    const action=useServiceAction(remote)
    const [loaded,setLoaded]=useState<{remote:NonNullable<typeof remote>,value:Current}|null>(null)
    const [answers,setAnswers]=useState<Answers>({})
    const [sent,setSent]=useState(false)
    const [pending,setPending]=useState<{nonce:string,answers:Answers}|null>(null)
    const current=useRef(remote);current.current=remote
    useEffect(()=>{let active=true;setLoaded(null);setAnswers({});setSent(false);setPending(null);if(remote)void action.action(async()=>{const value=await remote.control.current();if(active)setLoaded({remote,value})});return()=>{active=false}},[remote])
    const form=loaded?.remote==remote?loaded?.value:null
    async function submit(event:React.FormEvent){event.preventDefault();if(!remote||!form)return;const request=pending??{nonce:crypto.randomUUID(),answers:cleanAnswers(form.fields,answers)};setPending(request);await action.action(async()=>{await remote.control.submit({version:form.version,...request});if(current.current==remote)setSent(true)})}
    if(!form)return <section className="form-paper"><h1>Опрос</h1><p>{action.error||'Проверяем доступ к актуальной публикации…'}</p></section>
    return <section className="form-paper">{sent?<div className="thankyou"><span className="petal">✳</span><h1>Спасибо, мы вас услышали.</h1><p>Ваш ответ сохранён. Он поможет команде выбрать следующий шаг.</p><button onClick={()=>{setSent(false);setPending(null);setAnswers({})}}>Заполнить ещё один ответ</button></div>:<form onSubmit={submit}><span className="chip">ОПРОС · ВЕРСИЯ {form.version}</span><h1>{form.title}</h1><p>{form.description}</p><Questions fields={form.fields} answers={answers} change={setAnswers} disabled={action.busy||!!pending}/>{action.error&&<p role="alert" className="error">{action.error}</p>}{pending&&!action.busy&&<p>При повторе отправится тот же ответ без создания дубликата.</p>}<button className="primary" disabled={action.busy||!remote}>{pending?'Повторить отправку':'Отправить ответ →'}</button><small>Ответы хранит команда опроса: {form.retentionDays} дней. Поля со звёздочкой обязательны.</small></form>}</section>
}


