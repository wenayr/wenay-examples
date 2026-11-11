import React, {useEffect, useRef, useState} from 'react'
import type {FormsDefinition} from '../backend/runtime'
import type {Answers} from '../backend/model'
import {useServiceSession} from '../shared/react/service-session'
import {useServiceAction} from '../shared/react/service-action'
import {useFormResource, type Resources} from './contracts'
import {Questions, cleanAnswers} from './questions'

export async function authenticate(account: string, password: string) {
    const response = await fetch('/api/forms/login', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({args: [{account, password}]})
    })
    const body = await response.json()
    if (!response.ok || !body.ok) {
        if (account == 'respondent' && body.error?.message == 'login refused') {
            throw new Error('Ссылка на опрос закрыта, обновлена или недействительна')
        }
        throw new Error(body.error?.message ?? 'Ссылка закрыта или недействительна')
    }
    return String(body.value.token)
}

export function Respondent({token}: {token: string}) {
    const connection = useServiceSession<FormsDefinition>({
        url: location.origin,
        storageKey: 'petal-respondent-session'
    })
    const action = useServiceAction(token)
    const [authorised, setAuthorised] = useState(false)

    useEffect(function openLink() {
        let active = true
        setAuthorised(false)
        void action.action(async function login() {
            const value = await authenticate('respondent', token)
            if (!active) return
            connection.setToken(value)
            setAuthorised(true)
        })
        return () => {active = false}
    }, [token])

    const failed = action.error || connection.error
    const open = authorised && connection.session

    let page = null
    if (open && connection.me?.resources?.includes('publicform')) {
        page = <PublicForm resources={connection.session!.resources}/>
    } else if (open) {
        page = <section className="form-paper">
            <h1>Ссылка на опрос обновилась</h1>
            <p>Автор закрыл эту публикацию. Попросите новую ссылку, чтобы продолжить.</p>
        </section>
    } else if (!failed) {
        page = <p>Открываем опрос…</p>
    }

    return <main className="respondent">
        <a href="/" className="public-brand">✳ petal<span>ОПРОС КОМАНДЫ</span></a>
        {failed && <section className="form-paper">
            <h1>Опрос сейчас недоступен</h1>
            <p role="alert">{failed}</p>
            <p>Попросите автора прислать новую ссылку.</p>
        </section>}
        {page}
        <footer>Форма создана в Petal. Ответы доступны команде опроса.</footer>
    </main>
}

function PublicForm({resources}: {resources: Resources}) {
    const remote = useFormResource(resources, 'publicform')
    type Current = Awaited<ReturnType<NonNullable<typeof remote>['control']['current']>>

    const action = useServiceAction(remote)
    const [loaded, setLoaded] = useState<{remote: NonNullable<typeof remote>, value: Current} | null>(null)
    const [answers, setAnswers] = useState<Answers>({})
    const [sent, setSent] = useState(false)
    const [pending, setPending] = useState<{nonce: string, answers: Answers} | null>(null)
    const current = useRef(remote)
    current.current = remote

    useEffect(function loadPublication() {
        let active = true
        setLoaded(null)
        setAnswers({})
        setSent(false)
        setPending(null)
        if (!remote) return
        void action.action(async function read() {
            const value = await remote.control.current()
            if (active) setLoaded({remote, value})
        })
        return () => {active = false}
    }, [remote])

    const form = loaded?.remote == remote ? loaded?.value : null

    // Повтор отправляет тот же nonce: сервис распознаёт его как один ответ.
    async function submit(event: React.FormEvent) {
        event.preventDefault()
        if (!remote || !form) return
        const request = pending ?? {nonce: crypto.randomUUID(), answers: cleanAnswers(form.fields, answers)}
        setPending(request)
        await action.action(async function send() {
            await remote.control.submit({version: form.version, ...request})
            if (current.current == remote) setSent(true)
        })
    }
    function again() {
        setSent(false)
        setPending(null)
        setAnswers({})
    }

    if (!form) {
        return <section className="form-paper">
            <h1>{action.error ? 'Не удалось открыть опрос' : 'Открываем опрос…'}</h1>
            <p role={action.error ? 'alert' : 'status'}>{action.error || 'Проверяем доступ к актуальной публикации.'}</p>
            {action.error && <p>Обновите страницу. Если ошибка повторится, попросите автора проверить ссылку.</p>}
        </section>
    }

    const thanks = <div className="thankyou">
        <span className="petal">✳</span>
        <h1>Ответ сохранён</h1>
        <p>Спасибо за участие. Команда опроса увидит ваши ответы в результатах.</p>
        <button onClick={again}>Заполнить ещё один ответ</button>
    </div>

    const questions = <form onSubmit={submit}>
        <span className="chip">ОПРОС · ВЕРСИЯ {form.version}</span>
        <h1>{form.title}</h1>
        <p>{form.description}</p>
        <Questions
            fields={form.fields}
            answers={answers}
            change={setAnswers}
            disabled={action.busy || !!pending}
        />
        {action.error && <p role="alert" className="error">{action.error}</p>}
        {pending && !action.busy && (
            <p>При повторе отправится тот же ответ без создания дубликата.</p>
        )}
        <button className="primary" disabled={action.busy || !remote}>
            {pending ? 'Повторить отправку' : 'Отправить ответ →'}
        </button>
        <small>
            Ответы хранит команда опроса: {form.retentionDays} дней.
            Поля со звёздочкой обязательны.
        </small>
    </form>

    return <section className="form-paper">{sent ? thanks : questions}</section>
}
