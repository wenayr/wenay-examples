import React, {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {BoardMarks, BoardPeople, useBoardPresence, type BoardResources} from './collaboration'
import {useReorderBoard} from 'wenay-react2/react'
import {WORK_COLUMNS, type WorkTask, type WorkView, type WorkPerson} from './model'
import './style.css'
import {WorkloadPanel} from './workload'
import {CanvasBoard} from './canvas'
import {TaskGhosts} from './task-ghosts'
import {ScreenPanel, type ScreenResources} from './screen'
import {ChatPanel, type ChatResources} from './chat'

import type {tClientCommands} from 'wenay-common2/service/client'
import type {organizerDefinition} from './service'
import type {tCommandRun} from '../shared/react/command-action'
type tRun = tCommandRun<tClientCommands<typeof organizerDefinition>>

type TaskDraft = {
    id: string,
    revision: number,
    title: string,
    description: string,
    assignee: string,
    due: string,
    priority: 'normal' | 'high',
    sourceId: string,
    checklist: NonNullable<WorkTask['checklist']>
}

type OrganizerProps = {
    value: WorkView,
    busy: boolean,
    run: tRun,
    initialSource?: string,
    openSource?: (source: NonNullable<WorkTask['source']>) => void,
    resources?: BoardResources & ScreenResources & ChatResources
}

function newTask(me: string, sourceId = ''): TaskDraft {
    return {
        id: '',
        revision: 0,
        title: '',
        description: '',
        assignee: me,
        due: '',
        priority: 'normal',
        sourceId,
        checklist: []
    }
}

function localDay() {
    return new Date().toLocaleDateString('sv-SE')
}

// Смещение призрака передаём долями карточки: у получателя другой масштаб экрана.
function share(delta: number, size: number) {
    return Math.max(-64, Math.min(64, delta / size))
}

const scopes = [
    {id: 'all', title: 'Все задачи'},
    {id: 'overdue', title: 'Просрочены'},
    {id: 'today', title: 'На сегодня'},
    {id: 'done', title: 'Завершены'}
] as const

export function Organizer(props: OrganizerProps) {
    const {value, busy, run, initialSource = '', openSource, resources} = props
    const [tab, setTab] = useState('board')
    const presence = useBoardPresence({
        resources,
        enabled: tab != 'people',
        surface: tab == 'canvas' ? 'canvas' : 'tasks'
    })
    const [filter, setFilter] = useState('')
    const [query, setQuery] = useState('')
    const [scope, setScope] = useState<string>('all')
    const [today, setToday] = useState(localDay)
    const [draft, setDraft] = useState(() => newTask(value.me, initialSource))
    const [formOpen, setFormOpen] = useState(!!initialSource)
    const [person, setPerson] = useState<WorkPerson | null>(null)
    const grabbed = useRef<{id: string, revision: number}|null>(null)
    const boardElement = useRef<HTMLDivElement | null>(null)
    const handles = useRef(new Map<string, HTMLButtonElement>())
    const keyboardFocus = useRef<{id: string, revision: number}|null>(null)
    const dragOrigin = useRef<{width: number, height: number, generation: number} | null>(null)
    const [dragNotice, setDragNotice] = useState('')
    useEffect(function followCard() {
        if (!presence.selected) return
        const found = boardElement.current?.querySelectorAll<HTMLElement>('[data-work-task]') ?? []
        const card = [...found].find(item => item.dataset.workTask == presence.selected)
        card?.scrollIntoView({block: 'nearest', inline: 'nearest'})
    }, [presence.selected, presence.follow, value.columns])
    useEffect(function trackDay() {
        const timer = setInterval(function updateDay() {setToday(localDay())}, 30000)
        return function stop() {clearInterval(timer)}
    }, [])
    const assigned = Object.values(value.tasks).filter(task => !filter || task.assignee == filter)
    function inScope(task: WorkTask, selection: string) {
        if (selection == 'overdue') return task.status != 'done' && !!task.due && task.due < today
        if (selection == 'today') return task.status != 'done' && task.due == today
        if (selection == 'done') return task.status == 'done'
        return true
    }
    // Карточка видна, если проходит фильтр исполнителя, выборку и поиск по тексту.
    function visible(id: string) {
        const task = value.tasks[id]
        if (filter && task.assignee != filter) return false
        if (!inScope(task, scope)) return false
        const text = [task.title, task.description, task.source?.label ?? ''].join(' ')
        const needle = query.trim().toLocaleLowerCase('ru-RU')
        return text.toLocaleLowerCase('ru-RU').includes(needle)
    }
    const columns = value.columns.map(function shown(column) {
        return {...column, items: column.items.filter(visible)}
    })
    function canEdit(task: WorkTask) {
        if (task.automatic) return false
        return value.manage || task.assignee == value.me || task.createdBy == value.me
    }
    useEffect(function restoreKeyboardFocus() {
        const pending = keyboardFocus.current
        if (!pending) return
        const task = value.tasks[pending.id]
        if (task && task.revision <= pending.revision) return
        keyboardFocus.current = null
        const handle = task && canEdit(task) ? handles.current.get(pending.id) : null
        if (!handle || !document.hasFocus()) return
        // Фокус возвращаем только тогда, когда пользователь не ушёл на другой элемент.
        const idle = document.activeElement == document.body || document.activeElement == null
        if (idle) handle.focus()
    })
    const board = useReorderBoard({
        columns,
        autoScroll: {
            edge: 48,
            maxSpeed: 420,
            canScroll: function boardScroll(element) {
                if (element == boardElement.current) return true
                return element.classList.contains('work-column')
            }
        },
        canDrag: function canDrag(id) {
            if (busy || (resources && presence.phase != 'ready')) return false
            return canEdit(value.tasks[id])
        },
        onDragStart: function rememberVersion({key, from}) {
            grabbed.current = {id: key, revision: value.tasks[key].revision}
            const rect = handles.current.get(key)?.closest('article')?.getBoundingClientRect()
            dragOrigin.current = {
                width: rect?.width ?? 240,
                height: rect?.height ?? 180,
                generation: presence.generation
            }
            setDragNotice('')
            publishDrag(key, from, {x: 0, y: 0})
        },
        onDragMove: function movePreview({key, over, position}) {
            publishDrag(key, over, position)
        },
        onOverChange: function targetPreview({key, over}) {
            publishDrag(key, over, {x: 0, y: 0})
        },
        onDragEnd: function endPreview() {
            presence.update({drag: null})
        },
        commit: function commitDrop(next) {
            const task = grabbed.current
            if (!task) return
            const column = next.find(column => column.items.includes(task.id))!
            if (board.inputMode=='keyboard') keyboardFocus.current = task
            else keyboardFocus.current = null
            void run('workMoveTask', {
                ...task,
                status: column.key as WorkTask['status'],
                beforeId: column.items[column.items.indexOf(task.id)+1] ?? ''
            }).then(function failed(ok) {
                if (!ok && keyboardFocus.current == task) keyboardFocus.current = null
            })
        }
    })
    function publishDrag(key: string, over: {col: string, index: number}, delta: {x: number, y: number}) {
        const original = grabbed.current
        if (!original || original.id != key) return
        const items = columns.find(column => column.key == over.col)?.items.filter(id => id != key) ?? []
        // При клавиатурном переносе браузер не двигает карточку: смещение считаем сами.
        if (board.inputMode == 'keyboard') {
            const source = handles.current.get(key)?.closest('article')?.getBoundingClientRect()
            const lane = laneElement(over.col)
            const cards = [...(lane?.children ?? [])] as HTMLElement[]
            const before = items[over.index]
            const anchor = cards.find(item => item.dataset.workTask == before)
            const last = cards.filter(item => item.dataset.workTask != key).at(-1)
            if (source && lane) {
                const box = lane.getBoundingClientRect()
                const top = anchor?.getBoundingClientRect().top
                    ?? last?.getBoundingClientRect().bottom
                    ?? box.top
                delta = {x: box.left - source.left, y: top - source.top}
            }
        }
        presence.update({
            selected: key,
            drag: {
                kind: 'task',
                id: key,
                revision: original.revision,
                col: over.col,
                before: items[over.index] ?? '',
                x: share(delta.x, dragOrigin.current?.width ?? 240),
                y: share(delta.y, dragOrigin.current?.height ?? 180)
            }
        })
    }
    function laneElement(col: string) {
        const lanes = boardElement.current?.querySelectorAll<HTMLElement>('[data-work-column]') ?? []
        return [...lanes].find(lane => lane.dataset.workColumn == col)
    }
    useEffect(function stopPreview() {
        if (!board.dragKey) presence.update({drag: null})
    }, [board.dragKey])
    useEffect(function showKeyboardDestination() {
        if (board.inputMode != 'keyboard' || !board.dragKey || !board.over) return
        const lane = columns.find(column => column.key == board.over!.col)
        const ids = lane?.items.filter(id => id != board.dragKey) ?? []
        const id = ids[board.over.index] ?? ids.at(-1)
        const element = laneElement(board.over.col)
        const cards = [...(element?.children ?? [])] as HTMLElement[]
        const target = cards.find(card => card.dataset.workTask == id) ?? element
        target?.scrollIntoView({block: 'nearest', inline: 'nearest'})
    }, [board.inputMode, board.dragKey, board.over?.col, board.over?.index])
    // Начатый перенос теряет смысл, если карточку изменили, права сняли или связь прервалась.
    function dragOutdated(original: {id: string, revision: number}) {
        if (busy || tab != 'board') return true
        if (resources && presence.phase != 'ready') return true
        if (presence.generation != dragOrigin.current?.generation) return true
        const task = value.tasks[original.id]
        if (!task || task.revision != original.revision) return true
        return !canEdit(task)
    }
    useEffect(function invalidateDrag() {
        const original = grabbed.current
        if (!board.dragKey || !original) return
        if (!dragOutdated(original)) return
        board.cancel()
        presence.update({drag: null})
        setDragNotice('Перемещение отменено: карточка, права или подключение изменились.')
    }, [busy, tab, value, presence.phase, presence.generation, board.dragKey])
    useEffect(function changedFilter() {
        board.cancel()
        presence.update({drag: null})
    }, [filter, query, scope, tab])
    useEffect(function hidden() {
        function cancelHidden() {
            if (document.hidden) board.cancel()
        }
        document.addEventListener('visibilitychange', cancelHidden)
        return function stop() {
            document.removeEventListener('visibilitychange', cancelHidden)
        }
    }, [])
    function edit(task: WorkTask) {
        setDraft({
            id: task.id,
            revision: task.revision,
            title: task.title,
            description: task.description,
            assignee: task.assignee,
            due: task.due,
            priority: task.priority,
            sourceId: task.source?.kind == 'order' ? task.source.id : '',
            checklist: (task.checklist ?? []).map(item => ({...item}))
        })
        setFormOpen(true)
    }
    function eyebrow(task: WorkTask) {
        if (task.automatic) return 'Автоматическая'
        return task.priority == 'high' ? 'Высокий приоритет' : 'Задача команды'
    }
    function personName(account: string | undefined) {
        return value.people.find(person => person.account == account)?.name
    }
    function heading(task: WorkTask) {
        return <>
            <small>{eyebrow(task)}</small>
            <h3>{task.title}</h3>
            <p>{personName(task.assignee) ?? 'Без исполнителя'}</p>
        </>
    }
    // Клик по панели участников — это навигация по чужому курсору, а не своя работа.
    function ownAction(event: React.SyntheticEvent) {
        if (event.target instanceof Element && event.target.closest('.work-presence')) return
        presence.interact()
    }
    const tabs = <div className="work-heading">
        <div>
            <small>ЛЮДИ · РАБОТА · РЕЗУЛЬТАТ</small>
            <h2>Команда и задачи</h2>
        </div>
        <div className="work-toolbar">
            <button type="button" aria-pressed={tab == 'board'} onClick={function boardTab() {
                setTab('board')
            }}>Доска</button>
            <button type="button" aria-pressed={tab == 'canvas'} onClick={function canvasTab() {
                setTab('canvas')
            }}>Свободная доска</button>
            <button type="button" aria-pressed={tab == 'people'} onClick={function peopleTab() {
                setTab('people')
            }}>Сотрудники</button>
        </div>
    </div>

    const summary = <div className="work-summary">
        {scopes.map(item => (
            <button
                className="work-summary-card"
                key={item.id}
                aria-pressed={scope == item.id}
                onClick={function selectScope() {setScope(item.id)}}
            >
                <strong>{assigned.filter(task => inScope(task, item.id)).length}</strong>
                <span>{item.title}</span>
            </button>
        ))}
    </div>

    const filters = <div className="work-toolbar work-filters">
        <button className="primary" disabled={busy} onClick={function addTask() {
            setDraft(newTask(value.me))
            setFormOpen(true)
        }}>+ Новая задача</button>
        <label>Поиск задач
            <input
                type="search"
                placeholder="Название, описание или заказ"
                value={query}
                onChange={function search(event) {setQuery(event.target.value)}}
            />
        </label>
        <label>Исполнитель
            <select
                value={filter}
                onChange={function filterPerson(event) {setFilter(event.target.value)}}
            >
                <option value="">Все доступные задачи</option>
                {value.people.map(person => (
                    <option key={person.account} value={person.account}>{person.name}</option>
                ))}
            </select>
        </label>
        <button aria-pressed={filter == value.me} onClick={function myTasks() {
            setFilter(filter == value.me ? '' : value.me)
        }}>Мои задачи</button>
    </div>

    async function saveTask(event: React.FormEvent) {
        event.preventDefault()
        if (!await run('workSaveTask', draft)) return
        setFormOpen(false)
        setDraft(newTask(value.me))
    }
    function changeStep(index: number, title: string) {
        const checklist = draft.checklist.map(function step(item, at) {
            return at == index ? {...item, title} : item
        })
        setDraft({...draft, checklist})
    }

    const checklistFields = <div className="work-checklist">
        <h4>Что проверить перед завершением</h4>
        {draft.checklist.map((item, index) => (
            <div className="work-row" key={index}>
                <label>Пункт {index + 1}
                    <input
                        required
                        maxLength={200}
                        value={item.title}
                        onChange={event => changeStep(index, event.target.value)}
                    />
                </label>
                <button type="button" onClick={function removeStep() {
                    setDraft({...draft, checklist: draft.checklist.filter((_, at) => at != index)})
                }}>Удалить пункт {index + 1}</button>
            </div>
        ))}
        <button type="button" disabled={draft.checklist.length >= 30} onClick={function addStep() {
            setDraft({...draft, checklist: [...draft.checklist, {title: '', done: false}]})
        }}>+ Пункт проверки</button>
    </div>

    const taskForm = formOpen && <form className="work-form" onSubmit={saveTask}>
        <fieldset disabled={busy}>
            <h3>{draft.id ? 'Редактировать задачу' : 'Новая задача'}</h3>
            <label>Название задачи
                <input
                    value={draft.title}
                    required
                    maxLength={160}
                    onChange={event => setDraft({...draft, title: event.target.value})}
                />
            </label>
            <label>Описание задачи
                <textarea
                    rows={3}
                    maxLength={3000}
                    value={draft.description}
                    onChange={event => setDraft({...draft, description: event.target.value})}
                />
            </label>
            <div className="work-row">
                <label>Назначить
                    <select
                        value={draft.assignee}
                        disabled={!value.manage}
                        onChange={event => setDraft({...draft, assignee: event.target.value})}
                    >
                        <option value="">Без исполнителя</option>
                        {value.people.map(person => (
                            <option key={person.account} value={person.account}>{person.name}</option>
                        ))}
                    </select>
                </label>
                <label>Срок
                    <input
                        type="date"
                        value={draft.due}
                        onChange={event => setDraft({...draft, due: event.target.value})}
                    />
                </label>
                <label>Приоритет
                    <select
                        value={draft.priority}
                        onChange={event => setDraft({
                            ...draft,
                            priority: event.target.value as TaskDraft['priority']
                        })}
                    >
                        <option value="normal">Обычный</option>
                        <option value="high">Высокий</option>
                    </select>
                </label>
            </div>
            {!!value.sources.length && <label>Связанный заказ
                <select
                    value={draft.sourceId}
                    onChange={event => setDraft({...draft, sourceId: event.target.value})}
                >
                    <option value="">Без связи с заказом</option>
                    {value.sources.map(source => (
                        <option key={source.id} value={source.id}>{source.label}</option>
                    ))}
                </select>
            </label>}
            {checklistFields}
            <div className="work-toolbar">
                <button className="primary">Сохранить задачу</button>
                <button type="button" onClick={function cancel() {setFormOpen(false)}}>Отмена</button>
            </div>
        </fieldset>
    </form>

    // Чужое перемещение показываем, а одновременное с нашим — предупреждением о гонке.
    function conflictNote(id: string) {
        const movers = presence.others.filter(person => person.drag?.id == id)
        if (!movers.length) return null
        const race = board.dragKey == id || movers.length > 1
        return <small className="canvas-conflict">
            {race
                ? 'Одновременное перемещение. Сохранится первая актуальная команда.'
                : 'Другой участник перемещает карточку'}
        </small>
    }
    function dueNote(task: WorkTask) {
        const overdue = task.status != 'done' && task.due < today
        let label = 'Срок · '
        if (overdue) label = 'Просрочено · '
        else if (task.due == today) label = 'Сегодня · '
        const date = new Date(task.due + 'T12:00:00')
        return <p className={overdue ? 'work-overdue' : ''}>
            {label}
            {date.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short', year: 'numeric'})}
        </p>
    }
    function checklistView(task: WorkTask) {
        const checklist = task.checklist ?? []
        const done = checklist.filter(item => item.done).length
        return <div className="work-checklist">
            <p>Проверено {done} из {checklist.length}</p>
            <progress
                className="work-progress"
                aria-label={'Проверка: ' + task.title}
                value={done}
                max={checklist.length}
            />
            {checklist.map((step, index) => (
                <label className="work-check" key={index}>
                    <input
                        type="checkbox"
                        checked={step.done}
                        disabled={busy || !canEdit(task) || task.status == 'done'}
                        onChange={event => void run('workCheckTask', {
                            id: task.id,
                            revision: task.revision,
                            index,
                            done: event.target.checked
                        })}
                    />
                    {step.title}
                </label>
            ))}
        </div>
    }
    function cardActions(task: WorkTask) {
        const locked = task.status == 'done'
        return <div className="work-card-actions">
            <button
                type="button"
                disabled={busy || locked}
                title={locked ? 'Для редактирования верните задачу в работу' : undefined}
                onClick={function editTask() {edit(task)}}
            >
                Открыть
            </button>
            <label>Переместить
                <select
                    aria-label={'Статус: ' + task.title}
                    value={task.status}
                    disabled={busy}
                    onChange={event => void run('workMoveTask', {
                        id: task.id,
                        revision: task.revision,
                        status: event.target.value as WorkTask['status'],
                        beforeId: ''
                    })}
                >
                    {WORK_COLUMNS.map(column => (
                        <option key={column.key} value={column.key}>{column.title}</option>
                    ))}
                </select>
            </label>
        </div>
    }
    function grip(id: string, task: WorkTask) {
        return <button
            className="work-grip"
            aria-label={'Переместить ' + task.title}
            aria-describedby="work-move-help"
            {...board.item(id).handleProps}
            ref={function handle(element) {
                if (element) handles.current.set(id, element)
                else handles.current.delete(id)
            }}
        >
            ⋮⋮
        </button>
    }
    function card(id: string) {
        const task = value.tasks[id]
        const item = board.item(id)
        const dragged = item.dragging && board.overlay && board.inputMode == 'pointer'
        const style = {
            ...item.style,
            visibility: dragged ? 'hidden' as const : undefined,
            transition: item.active && !item.dragging ? 'transform 120ms ease' : undefined
        }
        function select() {
            presence.update({selected: id})
        }
        function cursor(event: React.PointerEvent) {
            const rect = event.currentTarget.getBoundingClientRect()
            presence.update({cursor: {
                task: id,
                x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
            }})
        }
        return <article
            data-work-task={id}
            tabIndex={0}
            onFocus={select}
            onPointerDown={select}
            onPointerMove={cursor}
            onPointerLeave={function leaveCard() {presence.update({cursor: null})}}
            className={'work-card ' + (task.priority == 'high' ? 'urgent' : '')}
            key={id}
            style={style}
        >
            <BoardMarks id={id} participants={presence.others}/>
            {conflictNote(id)}
            {canEdit(task) && grip(id, task)}
            {heading(task)}
            {task.description && <p className="work-description">{task.description}</p>}
            {task.due && dueNote(task)}
            {!!task.checklist?.length && checklistView(task)}
            {task.completedAt && <p>
                Завершил {personName(task.completedBy) ?? task.completedBy}
                {' · '}
                {new Date(task.completedAt).toLocaleString('ru-RU')}
            </p>}
            {task.source && (openSource
                ? <button className="work-source" type="button" onClick={function source() {
                    openSource(task.source!)
                }}>{task.source.label}</button>
                : <small>{task.source.label}</small>)}
            {canEdit(task) && cardActions(task)}
        </article>
    }

    const lanes = <div
        className="work-board"
        ref={boardElement}
        onPointerDownCapture={presence.interact}
        onKeyDownCapture={presence.interact}
        onWheel={presence.interact}
        onPointerLeave={function leaveBoard() {presence.update({cursor: null})}}
    >
        {columns.map(column => (
            <section className="work-lane" key={column.key}>
                <h3>
                    {WORK_COLUMNS.find(item => item.key == column.key)?.title}
                    {' '}
                    <span>{column.items.length}</span>
                </h3>
                <div
                    className="work-column"
                    data-work-column={column.key}
                    ref={board.columnRef(column.key)}
                >
                    {column.items.map(card)}
                </div>
            </section>
        ))}
    </div>

    function moveStatus() {
        if (board.inputMode != 'keyboard' || !board.dragKey || !board.over) return ''
        const column = WORK_COLUMNS.find(item => item.key == board.over!.col)?.title
        return `Перемещение: колонка ${column}, позиция ${board.over.index + 1}`
    }

    const taskBoard = <>
        {summary}
        {filters}
        <p className="work-help" id="work-move-help">
            Переносите ручные карточки за ⋮⋮ или выбирайте статус.
            На ручке: Пробел или Enter — начать и завершить,
            стрелки — выбрать место, Escape — отменить.
            {value.sources.length > 0 && 'Автоматические задачи следуют заказам и складу.'}
            {' '}Срок включительно, по местной дате.
        </p>
        {taskForm}
        {lanes}
        <p className="work-move-status" aria-live="polite">{moveStatus()}</p>
        {dragNotice && <p role="status" className="work-help">{dragNotice}</p>}
        {resources && <TaskGhosts participants={presence.others} root={boardElement} value={value}/>}
        {board.overlay && createPortal(<div
            aria-hidden="true"
            className="work-card work-drag-overlay"
            style={{...board.overlay.style, zIndex: 10000, pointerEvents: 'none'}}
        >
            {heading(value.tasks[board.overlay.key])}
        </div>, document.body)}
    </>

    function personCard(employee: WorkPerson) {
        const tasks = Object.values(value.tasks).filter(task => task.assignee == employee.account)
        const roles = employee.roles.map(function title(role) {
            return value.roleOptions.find(option => option.id == role)?.title ?? role
        })
        return <article className="work-person" key={employee.account}>
            <div className="work-avatar">{employee.name.slice(0, 1).toUpperCase()}</div>
            <h3>{employee.name}</h3>
            <small>@{employee.account} · {employee.position || 'Должность не указана'}</small>
            <p>{roles.join(' · ')}</p>
            <p>
                Задачи: {employee.canManage ? 'управление всей командой' : 'свои задачи'}
                {employee.roles.includes('owner') ? ' · управление правами' : ''}
            </p>
            {employee.note && <p>{employee.note}</p>}
            <p>
                Незавершённых задач в доступной вам выборке:
                {' '}{tasks.filter(task => task.status != 'done').length}
                <br/>
                Просрочено: {tasks.filter(task => inScope(task, 'overdue')).length}
            </p>
            <div className="work-toolbar">
                <button onClick={function showTasks() {
                    setFilter(employee.account)
                    setScope('all')
                    setQuery('')
                    setTab('board')
                }}>Задачи</button>
                {value.manage && <button disabled={busy} onClick={function editPerson() {
                    setPerson({...employee, roles: [...employee.roles]})
                }}>Карточка сотрудника</button>}
            </div>
        </article>
    }

    const people = <>
        <div className="work-toolbar">
            {value.owner && <button className="primary" disabled={busy} onClick={function add() {
                setPerson({
                    account: '',
                    name: '',
                    roles: [value.roleOptions[0].id],
                    position: '',
                    note: '',
                    canManage: false
                })
            }}>+ Новый сотрудник</button>}
            <p>
                Роли определяют доступ в текущем приложении.
                Только владелец создаёт аккаунты и меняет права.
            </p>
        </div>
        <div className="work-people">{value.people.map(personCard)}</div>
        {person && <PersonForm
            key={person.account}
            person={person}
            value={value}
            busy={busy}
            run={run}
            close={function close() {setPerson(null)}}
        />}
    </>

    let page = people
    if (tab == 'board') page = taskBoard
    if (tab == 'canvas') {
        page = <CanvasBoard value={value} busy={busy} run={run} presence={presence}/>
    }

    return <section
        className="work-app"
        aria-label="Органайзер команды"
        onPointerDownCapture={ownAction}
        onKeyDownCapture={ownAction}
    >
        {tabs}
        <WorkloadPanel value={value}/>
        {resources && <ScreenPanel resources={resources}/>}
        {resources && <ChatPanel
            resources={resources}
            work={value}
            apply={(proposal, items) => run('workApplyProposal', {proposal, items})}
        />}
        {tab != 'people' && resources && <BoardPeople presence={presence} show={function showAll() {
            setFilter('')
            setQuery('')
            setScope('all')
        }}/>}
        {page}
    </section>
}

type PersonProps = {
    person: WorkPerson,
    value: WorkView,
    busy: boolean,
    run: tRun,
    close: () => void
}

function PersonForm({person, value, busy, run, close}: PersonProps) {
    const [draft, setDraft] = useState(function editablePerson() {
        const {canManage, ...fields} = person
        return {...fields, password: ''}
    })

    async function save(event: React.FormEvent) {
        event.preventDefault()
        if (await run('workSavePerson', draft)) close()
    }
    function toggleRole(role: string, checked: boolean) {
        const roles = checked ? [...draft.roles, role] : draft.roles.filter(id => id != role)
        setDraft({...draft, roles})
    }

    return <form className="work-form" onSubmit={save}>
        <fieldset disabled={busy}>
            <h3>{person.account ? 'Карточка сотрудника' : 'Новый сотрудник'}</h3>
            <div className="work-row">
                <label>Логин сотрудника
                    <input
                        required
                        pattern="[a-z][a-z0-9_-]{2,31}"
                        disabled={!!person.account}
                        value={draft.account}
                        onChange={event => setDraft({...draft, account: event.target.value})}
                    />
                </label>
                <label>Имя сотрудника
                    <input
                        required
                        maxLength={100}
                        value={draft.name}
                        onChange={event => setDraft({...draft, name: event.target.value})}
                    />
                </label>
                <label>Должность
                    <input
                        maxLength={100}
                        value={draft.position}
                        onChange={event => setDraft({...draft, position: event.target.value})}
                    />
                </label>
            </div>
            {!person.account && <label>Начальный пароль
                <input
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    value={draft.password}
                    onChange={event => setDraft({...draft, password: event.target.value})}
                />
            </label>}
            <label>Заметка менеджера
                <textarea
                    rows={2}
                    maxLength={1000}
                    value={draft.note}
                    onChange={event => setDraft({...draft, note: event.target.value})}
                />
            </label>
            <div className="work-toolbar">
                {value.roleOptions.map(role => (
                    <label className="work-check" key={role.id}>
                        <input
                            type="checkbox"
                            checked={draft.roles.includes(role.id)}
                            disabled={!value.owner}
                            onChange={event => toggleRole(role.id, event.target.checked)}
                        />
                        {role.title}
                    </label>
                ))}
            </div>
            <button className="primary">Сохранить сотрудника</button>
            {' '}
            <button type="button" onClick={close}>Отмена</button>
        </fieldset>
    </form>
}
