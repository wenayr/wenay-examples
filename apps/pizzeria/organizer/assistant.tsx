import React, {useEffect, useState} from 'react'
import {createAiRunClient} from 'wenay-common2/ai'
import {useAiRunClient, useOwnedClient} from 'wenay-react2/react'
import {useServiceAction} from '../shared/react/service-action'
import type {ChatRemote} from './chat'
import type {Proposal} from './assistant-resource'
import type {WorkView} from './model'

export function AssistantPanel({remote, room, work, apply, file}: {remote: ChatRemote, room: string, work: WorkView, apply: (id: string, items: Proposal['items']) => Promise<boolean>, file: string}) {
    const owned = useOwnedClient({key: remote, create: () => createAiRunClient({remote: remote.ai})})
    const ai = useAiRunClient(owned.ready ? owned.client : null)
    const action = useServiceAction(remote)
    const [text, setText] = useState('')
    const [saved, setSaved] = useState<{id: string, result: Proposal}[]>([])
    useEffect(function restore() {let active = true; void remote.control.results(room).then(value => {if (active) setSaved(value)}).catch(() => {}); return () => {active = false}}, [remote, room, ai.lastEvent])
    function run(kind: string) {return action.action(() => ai.client!.createRun({requestId: crypto.randomUUID(), kind, resourceIds: [room], input: {room, text, file}}))}
    const runs = Object.values(ai.runs).filter(run => run.resourceIds[0] == room)
    return <details><summary>Голос и помощник</summary><p>Платные запросы отключены до настройки провайдера. Тестовый исполнитель разбивает введённый текст на пункты; это проверка механизма, а не распознавание речи.</p>
        <label>Текст для тестового предложения<textarea maxLength={8000} value={text} onChange={event => setText(event.target.value)}/></label>
        <div className="work-toolbar"><button disabled={!ai.ready || action.busy || !text.trim()} onClick={() => void run('demo-tasks')}>Проверить предложение задач</button><button disabled={!ai.ready || action.busy} onClick={() => void run('demo-summary')}>Тестовая выдержка обсуждения</button><button disabled={!ai.ready || action.busy || !file} onClick={() => void run('transcribe')}>Распознать выбранное голосовое</button></div>
        {runs.map(run => <div key={run.id}><p>{run.kind == 'transcribe' ? 'Распознавание' : 'Тестовый исполнитель'} · {run.recovery ? 'Прервано перезапуском — требуется сверка результата' : ({queued: 'В очереди', running: 'Обработка', waiting_input: 'Ожидает ввода', waiting_approval: 'Ожидает подтверждения', completed: 'Готово', failed: 'Ошибка', cancelled: 'Отменено'}[run.state])} · {run.message ?? run.error}</p>{!run.recovery && <progress value={run.progress} max={1}/>} {run.recovery && <p>Повторный запрос не отправлен. Отмените запуск или обратитесь к оператору для сверки с провайдером.</p>}{['queued', 'running', 'waiting_input', 'waiting_approval'].includes(run.state) && <button disabled={action.busy} onClick={() => void action.action(() => ai.client!.cancelRun(run.id, 'Отменено пользователем'))}>Отменить обработку</button>}</div>)}
        {saved.map(item => <ProposalForm key={item.id} id={item.id} proposal={item.result} work={work} apply={apply}/>)}
        {action.error && <p role="alert">{action.error}</p>}
        <p>Результаты и состояние обработки сохраняются. Прерванный запуск после перезапуска требует сверки; автоматического повторного запроса нет.</p>
    </details>
}

function ProposalForm({id, proposal, work, apply}: {id: string, proposal: Proposal, work: WorkView, apply: (id: string, items: Proposal['items']) => Promise<boolean>}) {
    const [items, setItems] = useState(proposal.items)
    const [done, setDone] = useState(false)
    const action = useServiceAction(id)
    return <div className="chat-message"><p>{proposal.demo ? 'Тестовый результат' : 'Расшифровка'}</p><p>{proposal.transcript}</p>
        {!!items.length && <form onSubmit={async function confirm(event) {event.preventDefault(); await action.action(async function save() {if (await apply(id, items)) setDone(true)})}}><p>Уточните сроки и исполнителей. До подтверждения задачи не создаются.</p><fieldset disabled={done || action.busy}>
            {items.map((item, index) => <div className="work-row" key={index}><label>Работа<input required maxLength={160} value={item.title} onChange={event => setItems(items.map((other, i) => i == index ? {...other, title: event.target.value} : other))}/></label><label>Срок<input type="date" value={item.due} onChange={event => setItems(items.map((other, i) => i == index ? {...other, due: event.target.value} : other))}/></label><label>Исполнитель<select value={item.assignee} disabled={!work.manage} onChange={event => setItems(items.map((other, i) => i == index ? {...other, assignee: event.target.value} : other))}>{work.people.map(person => <option key={person.account} value={person.account}>{person.name}</option>)}</select></label></div>)}
            <button>{done ? 'Задачи созданы' : 'Подтвердить и создать задачи'}</button>
        </fieldset></form>}
    </div>
}
