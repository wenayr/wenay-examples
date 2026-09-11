import React from 'react'
import {useClientStore, useServiceCommands} from 'wenay-react2/react'
import type {ServiceClient} from 'wenay-common2/service/client'
import type {HostingDefinition} from '../backend/service'

const powerLabels = {unknown: 'Не подтверждено', running: 'Включена', stopped: 'Выключена'}

const operationLabels = {
    queued: 'Ожидает исполнителя',
    running: 'Выполняется',
    succeeded: 'Завершено',
    failed: 'Ошибка'
}

type MachinesProps = {
    client: ServiceClient<HostingDefinition>,
    project: string,
    allowed: string[]
}

export function Machines({client, project, allowed}: MachinesProps) {
    const view = useClientStore(client.views.machineDashboard)
    const commands = useServiceCommands(client.commands)
    const machines = view.state?.machines?.filter(item => item.project == project) ?? []
    const operations = view.state?.operations?.filter(item => item.project == project) ?? []

    async function create(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        try {
            await commands.run('createMachine', {
                id: String(data.get('id')),
                project,
                agent: String(data.get('agent')),
                kind: String(data.get('kind')),
                image: String(data.get('image')),
                cpus: Number(data.get('cpus')),
                memoryMiB: Number(data.get('memoryMiB')),
                diskGiB: Number(data.get('diskGiB')),
                sshKey: String(data.get('sshKey')).trim()
            })
            form.reset()
        } catch {}
    }

    async function power(machine: typeof machines[number], target: 'running' | 'stopped') {
        try {
            await commands.run('setMachinePower', {machine: machine.id, revision: machine.revision, target})
        } catch {}
    }

    // Исход операции объясняем словами: ошибка — деталью, успех — подтверждением питания.
    function operationDetail(operation: typeof operations[number]) {
        if (operation.status == 'failed') return operation.detail
        if (operation.status == 'succeeded') return 'Состояние питания подтверждено'
        return operationLabels[operation.status]
    }

    function card(machine: typeof machines[number]) {
        const pending = operations.find(item => item.id == machine.pending)
        return <article key={machine.id}>
            <div className="card-heading">
                <h3>{machine.id}</h3>
                <span className="badge">
                    {machine.spec.kind == 'container' ? 'Linux-контейнер' : 'Виртуальная машина'}
                </span>
            </div>
            <p>
                <b>{powerLabels[machine.power]}</b> · {machine.spec.cpus} CPU ·
                {' '}{machine.spec.memoryMiB} МиБ · {machine.spec.diskGiB} ГиБ
            </p>
            <p>Исполнитель: {machine.agent}<br/>Подготовка системы не проверена</p>
            {machine.pending && (
                <p role="status">{operationLabels[pending?.status ?? 'queued']}</p>
            )}
            {!machine.pending && allowed.includes('setMachinePower') && <div>
                {machine.power != 'running' && (
                    <button disabled={commands.pending} onClick={function start() {void power(machine, 'running')}}>
                        Включить {machine.id}
                    </button>
                )}
                {machine.power != 'stopped' && (
                    <button disabled={commands.pending} onClick={function stop() {void power(machine, 'stopped')}}>
                        Выключить {machine.id}
                    </button>
                )}
            </div>}
        </article>
    }

    const form = <details>
        <summary>Создать машину</summary>
        <p>
            Образ, сеть и хранилище должны быть подготовлены на сервере LXD.
            Создание включает машину, установка приложений — отдельный этап.
        </p>
        <form onSubmit={create}>
            <fieldset disabled={commands.pending}>
                <div className="two">
                    <label>Имя
                        <input name="id" pattern="[a-z][a-z0-9-]{0,62}" required/>
                    </label>
                    <label>Аккаунт исполнителя LXD
                        <input name="agent" required/>
                    </label>
                </div>
                <label>Тип
                    <select name="kind">
                        <option value="container">Linux-контейнер</option>
                        <option value="virtual-machine">Виртуальная машина</option>
                    </select>
                </label>
                <label>Отпечаток образа LXD
                    <input name="image" pattern="[a-f0-9]{64}" placeholder="64 символа SHA-256" required/>
                </label>
                <div className="two">
                    <label>Процессоры
                        <input name="cpus" type="number" min="1" max="64" defaultValue="1" required/>
                    </label>
                    <label>Память, МиБ
                        <input
                            name="memoryMiB"
                            type="number"
                            min="256"
                            max="262144"
                            defaultValue="512"
                            required
                        />
                    </label>
                </div>
                <label>Диск, ГиБ
                    <input name="diskGiB" type="number" min="2" max="2048" defaultValue="8" required/>
                </label>
                <label>Публичный SSH-ключ Ed25519
                    <input name="sshKey" placeholder="ssh-ed25519 AAAA…" required/>
                </label>
                <button className="primary">
                    {commands.pending ? 'Отправляем…' : 'Создать и включить'}
                </button>
            </fieldset>
        </form>
    </details>

    const history = <details>
        <summary>История операций с машинами</summary>
        {operations.toReversed().map(operation => (
            <article className="operation" key={operation.id}>
                <div>
                    <b>{operation.machine}</b> ·
                    {' '}{operation.target == 'running' ? 'Включение' : 'Выключение'}
                    <p>{operationDetail(operation)}</p>
                </div>
                <span className="badge">{operationLabels[operation.status]}</span>
            </article>
        ))}
    </details>

    let list = <div className="cards">{machines.map(card)}</div>
    if (!view.ready) list = <p role="status">Загружаем машины…</p>
    else if (!machines.length) list = <p>В проекте пока нет машин.</p>

    return <section>
        <h2>Машины</h2>
        <p className="muted">
            Отдельные Linux-контейнеры и виртуальные машины.
            Готовность системы и приложения проверяется отдельно от включения.
        </p>
        {list}
        {allowed.includes('createMachine') && form}
        {!!operations.length && history}
        {!!commands.error && (
            <p role="alert">
                {commands.error instanceof Error ? commands.error.message : String(commands.error)}
            </p>
        )}
    </section>
}
