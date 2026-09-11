import React, {useEffect, useState} from 'react'
import {createAiRunClient} from 'wenay-common2/ai'
import {useAiRunClient, useOwnedClient} from 'wenay-react2/react'
import {useServiceAction} from '../shared/react/service-action'
import type {ChatRemote} from './chat'
import type {Proposal} from './assistant-resource'
import type {WorkView} from './model'

const runStates: Record<string, string> = {
    queued: 'В очереди',
    running: 'Обработка',
    waiting_input: 'Ожидает ввода',
    waiting_approval: 'Ожидает подтверждения',
    completed: 'Готово',
    failed: 'Ошибка',
    cancelled: 'Отменено'
}

const busyStates = ['queued', 'running', 'waiting_input', 'waiting_approval']

type AssistantProps = {
    remote: ChatRemote,
    room: string,
    work: WorkView,
    apply: (id: string, items: Proposal['items']) => Promise<boolean>,
    file: string
}

export function AssistantPanel({remote, room, work, apply, file}: AssistantProps) {
    const owned = useOwnedClient({key: remote, create: () => createAiRunClient({remote: remote.ai})})
    const ai = useAiRunClient(owned.ready ? owned.client : null)
    const action = useServiceAction(remote)
    const [text, setText] = useState('')
    const [saved, setSaved] = useState<{id: string, result: Proposal}[]>([])

    useEffect(function restore() {
        let active = true
        void remote.control.results(room).then(function ready(value) {
            if (active) setSaved(value)
        }).catch(() => {})
        return () => {active = false}
    }, [remote, room, ai.lastEvent])

    function run(kind: string) {
        return action.action(() => ai.client!.createRun({
            requestId: crypto.randomUUID(),
            kind,
            resourceIds: [room],
            input: {room, text, file}
        }))
    }

    const runs = Object.values(ai.runs).filter(item => item.resourceIds[0] == room)

    // Прерванный перезапуском запуск не повторяется сам: результат сверяет человек.
    function runState(item: typeof runs[number]) {
        if (item.recovery) return 'Прервано перезапуском — требуется сверка результата'
        return runStates[item.state]
    }

    return <details>
        <summary>Голос и помощник</summary>
        <p>
            Платные запросы отключены до настройки провайдера.
            Тестовый исполнитель разбивает введённый текст на пункты,
            это проверка механизма, а не распознавание речи.
        </p>
        <label>Текст для тестового предложения
            <textarea maxLength={8000} value={text} onChange={event => setText(event.target.value)}/>
        </label>
        <div className="work-toolbar">
            <button
                disabled={!ai.ready || action.busy || !text.trim()}
                onClick={() => void run('demo-tasks')}
            >
                Проверить предложение задач
            </button>
            <button disabled={!ai.ready || action.busy} onClick={() => void run('demo-summary')}>
                Тестовая выдержка обсуждения
            </button>
            <button
                disabled={!ai.ready || action.busy || !file}
                onClick={() => void run('transcribe')}
            >
                Распознать выбранное голосовое
            </button>
        </div>
        {runs.map(item => (
            <div key={item.id}>
                <p>
                    {item.kind == 'transcribe' ? 'Распознавание' : 'Тестовый исполнитель'} ·
                    {' '}{runState(item)} · {item.message ?? item.error}
                </p>
                {!item.recovery && <progress value={item.progress} max={1}/>}
                {item.recovery && (
                    <p>
                        Повторный запрос не отправлен.
                        Отмените запуск или обратитесь к оператору для сверки с провайдером.
                    </p>
                )}
                {busyStates.includes(item.state) && <button
                    disabled={action.busy}
                    onClick={() => void action.action(() => ai.client!.cancelRun(item.id, 'Отменено пользователем'))}
                >
                    Отменить обработку
                </button>}
            </div>
        ))}
        {saved.map(item => (
            <ProposalForm key={item.id} id={item.id} proposal={item.result} work={work} apply={apply}/>
        ))}
        {action.error && <p role="alert">{action.error}</p>}
        <p>
            Результаты и состояние обработки сохраняются.
            Прерванный запуск после перезапуска требует сверки,
            автоматического повторного запроса нет.
        </p>
    </details>
}

type ProposalProps = {
    id: string,
    proposal: Proposal,
    work: WorkView,
    apply: (id: string, items: Proposal['items']) => Promise<boolean>
}

function ProposalForm({id, proposal, work, apply}: ProposalProps) {
    const [items, setItems] = useState(proposal.items)
    const [done, setDone] = useState(false)
    const action = useServiceAction(id)

    async function confirm(event: React.FormEvent) {
        event.preventDefault()
        await action.action(async function save() {
            if (await apply(id, items)) setDone(true)
        })
    }
    function change(index: number, patch: Partial<Proposal['items'][number]>) {
        setItems(items.map((other, at) => at == index ? {...other, ...patch} : other))
    }

    return <div className="chat-message">
        <p>{proposal.demo ? 'Тестовый результат' : 'Расшифровка'}</p>
        <p>{proposal.transcript}</p>
        {!!items.length && <form onSubmit={confirm}>
            <p>Уточните сроки и исполнителей. До подтверждения задачи не создаются.</p>
            <fieldset disabled={done || action.busy}>
                {items.map((item, index) => (
                    <div className="work-row" key={index}>
                        <label>Работа
                            <input
                                required
                                maxLength={160}
                                value={item.title}
                                onChange={event => change(index, {title: event.target.value})}
                            />
                        </label>
                        <label>Срок
                            <input
                                type="date"
                                value={item.due}
                                onChange={event => change(index, {due: event.target.value})}
                            />
                        </label>
                        <label>Исполнитель
                            <select
                                value={item.assignee}
                                disabled={!work.manage}
                                onChange={event => change(index, {assignee: event.target.value})}
                            >
                                {work.people.map(person => (
                                    <option key={person.account} value={person.account}>
                                        {person.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                ))}
                <button>{done ? 'Задачи созданы' : 'Подтвердить и создать задачи'}</button>
            </fieldset>
        </form>}
    </div>
}
