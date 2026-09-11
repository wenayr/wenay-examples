import React, {useRef, useState, useEffect} from 'react'
import {useReorderBoard} from 'wenay-react2/react'
import type {TaskBoards} from '../backend/organizer'
import {WORK_COLUMNS, type WorkTask} from '../organizer/task-model'
import type {Commands as CommandController} from './contracts'
import './tasks.css'

type TasksProps = {
    board: TaskBoards['boards'][number],
    commands: CommandController,
    busy: boolean
}

export function Tasks({board: value, commands, busy}: TasksProps) {
    const [editing, setEditing] = useState<WorkTask | null | undefined>(undefined)
    const grabbed = useRef<{id: string, revision: number} | null>(null)
    const byId = Object.fromEntries(value.tasks.map(task => [task.id, task]))

    const board = useReorderBoard({
        columns: value.columns,
        canDrag: id => !busy && !!byId[id],
        onDragStart({key}) {grabbed.current = {id: key, revision: byId[key].revision}},
        commit(next) {
            const task = grabbed.current
            if (!task) return
            const column = next.find(item => item.items.includes(task.id))!
            const at = column.items.indexOf(task.id)
            void commands.run('workMoveTask', {
                orgId: value.orgId,
                ...task,
                status: column.key as WorkTask['status'],
                beforeId: column.items[at + 1] ?? ''
            })
        }
    })

    // Пока карточку тащат, её могли изменить или запретить: тогда перенос отменяем.
    useEffect(function cancelStaleDrag() {
        const original = grabbed.current
        if (!board.dragKey || !original) return
        if (busy || byId[original.id]?.revision != original.revision) board.cancel()
    }, [busy, value, board.dragKey])

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const titles = String(form.get('checklist')).split('\n').filter(item => item.trim())
        // Отметку сохраняем только у пункта, который остался на своём месте с тем же текстом.
        const checklist = titles.map(function point(title, index) {
            const previous = editing?.checklist?.[index]
            const same = previous?.title == title.trim()
            return {title: title.trim(), done: same && !!previous.done}
        })
        const ok = await commands.run('workSaveTask', {
            orgId: value.orgId,
            id: editing?.id ?? '',
            revision: editing?.revision ?? 0,
            title: String(form.get('title')),
            description: String(form.get('description')),
            due: String(form.get('due')),
            assignee: String(form.get('assignee')),
            priority: String(form.get('priority')) as WorkTask['priority'],
            sourceId: editing?.source?.id ?? '',
            checklist
        })
        if (ok) setEditing(undefined)
    }

    const workload = <div className="task-workload">
        {value.people.map(person => (
            <span key={person.account}>
                {person.name.split(' · ')[0]}{' '}
                <strong>{openTasks(value.tasks, person.account)}</strong>
            </span>
        ))}
    </div>

    const form = <form key={editing?.id ?? 'new'} className="directory-form" onSubmit={save}>
        <fieldset disabled={busy}>
            <legend>{editing ? 'Изменить задачу' : 'Новая задача'}</legend>
            <label>Название
                <input name="title" defaultValue={editing?.title} required maxLength={160}/>
            </label>
            <label>Описание
                <textarea name="description" defaultValue={editing?.description} maxLength={3000}/>
            </label>
            <label>Исполнитель
                <select name="assignee" defaultValue={editing?.assignee || value.me}>
                    {value.people.filter(person => value.manager || person.account == value.me).map(person => (
                        <option key={person.account} value={person.account}>{person.name}</option>
                    ))}
                </select>
            </label>
            <label>Срок
                <input name="due" type="date" defaultValue={editing?.due}/>
            </label>
            <label>Приоритет
                <select name="priority" defaultValue={editing?.priority ?? 'normal'}>
                    <option value="normal">Обычный</option>
                    <option value="high">Высокий</option>
                </select>
            </label>
            <label>Что проверить (по одному пункту на строку)
                <textarea
                    name="checklist"
                    defaultValue={editing?.checklist?.map(item => item.title).join('\n')}
                    maxLength={6000}
                />
            </label>
            <button className="primary">Сохранить задачу</button>
            <button type="button" onClick={() => setEditing(undefined)}>Отмена</button>
        </fieldset>
    </form>

    function card(id: string) {
        const task = byId[id]
        const item = board.item(id)
        const assignee = value.people.find(person => person.account == task.assignee)
        return <article className={'task-card ' + task.priority} key={id} style={item.style}>
            <button
                {...item.handleProps}
                className="task-grip"
                aria-label={'Переместить ' + task.title}
                aria-describedby="task-move-help"
            >
                ⋮⋮
            </button>
            <h3>{task.title}</h3>
            <p>{task.description}</p>
            <small>
                {assignee?.name ?? task.assignee}{task.due ? ' · до ' + task.due : ''}
            </small>
            {task.source && <p className="muted">Инцидент: {task.source.label}</p>}
            {task.checklist?.map((step, index) => (
                <label key={index}>
                    <input
                        type="checkbox"
                        checked={step.done}
                        disabled={busy || task.status == 'done'}
                        onChange={event => void commands.run('workCheckTask', {
                            orgId: value.orgId,
                            id,
                            revision: task.revision,
                            index,
                            done: event.target.checked
                        })}
                    />
                    {step.title}
                </label>
            ))}
            <label>Статус
                <select
                    value={task.status}
                    disabled={busy}
                    onChange={event => void commands.run('workMoveTask', {
                        orgId: value.orgId,
                        id,
                        revision: task.revision,
                        status: event.target.value as WorkTask['status'],
                        beforeId: ''
                    })}
                >
                    {WORK_COLUMNS.map(status => (
                        <option key={status.key} value={status.key}>{status.title}</option>
                    ))}
                </select>
            </label>
            <button
                disabled={busy || task.status == 'done'}
                onClick={() => setEditing({...task, checklist: task.checklist?.map(item => ({...item}))})}
            >
                Изменить
            </button>
        </article>
    }

    const moving = board.dragKey && board.over
        ? 'Перемещение: ' + WORK_COLUMNS.find(item => item.key == board.over?.col)?.title
        : ''

    return <section className="support-tasks">
        <div className="page-title">
            <div>
                <p className="eyebrow">ОТ ДОГОВОРЁННОСТИ К РЕЗУЛЬТАТУ</p>
                <h1>Задачи команды</h1>
                <p>Карточки, сроки и проверка результата. Доступ ограничен вашей организацией.</p>
            </div>
            <button className="primary" disabled={busy} onClick={() => setEditing(null)}>
                + Новая задача
            </button>
        </div>
        {workload}
        {editing !== undefined && form}
        <p id="task-move-help" className="muted">
            Карточки можно перетаскивать за ручку. Клавиатура: пробел, стрелки, Enter.
            Escape отменяет перенос. Статус также можно выбрать в карточке.
        </p>
        <div className="task-lanes">
            {value.columns.map(column => (
                <section key={column.key}>
                    <h2>{column.title} <small>{column.items.length}</small></h2>
                    <div className="task-lane" ref={board.columnRef(column.key)}>
                        {column.items.map(card)}
                    </div>
                    {!column.items.length && <p className="muted">Здесь пока нет задач</p>}
                </section>
            ))}
        </div>
        <p aria-live="polite">{moving}</p>
    </section>
}

// Счётчик у имени: сколько задач человека ещё не завершено.
function openTasks(tasks: TaskBoards['boards'][number]['tasks'], account: string) {
    return tasks.filter(task => task.assignee == account && task.status != 'done').length
}
