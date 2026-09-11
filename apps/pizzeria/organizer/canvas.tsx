import React, {useEffect, useRef, useState} from 'react'
import {useDraggableApi} from 'wenay-react2/react'
import {BoardMarks, personColor, type useBoardPresence} from './collaboration'
import {CANVAS_SIZE, NOTE_COLORS, emptyCanvas, notePosition, type CanvasNote} from './canvas-model'
import type {WorkView} from './model'
import type {tClientCommands} from 'wenay-common2/service/client'
import type {organizerDefinition} from './service'
import type {tCommandRun} from '../shared/react/command-action'

type tRun = tCommandRun<tClientCommands<typeof organizerDefinition>>
type Presence = ReturnType<typeof useBoardPresence>
type NoteDraft = Pick<CanvasNote, 'id' | 'revision' | 'text' | 'color' | 'x' | 'y' | 'width' | 'height'>
const colorNames = {sand: 'Песочный', mint: 'Мятный', sky: 'Голубой', rose: 'Розовый'}

export function CanvasBoard({value, busy, run, presence}: {value: WorkView, busy: boolean, run: tRun, presence: Presence}) {
    const board = value.canvas ?? emptyCanvas()
    const notes = Object.values(board.notes)
    const [draft, setDraft] = useState<NoteDraft | null>(null)
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const surface = useRef<HTMLDivElement>(null)
    useEffect(function followNote() {
        if (!presence.selected) return
        const element = [...(surface.current?.querySelectorAll<HTMLElement>('[data-canvas-note]') ?? [])].find(element => element.dataset.canvasNote == presence.selected)
        element?.scrollIntoView({block: 'nearest', inline: 'nearest'})
    }, [presence.selected, presence.follow, value.canvas])
    function edit(note: CanvasNote) {
        const {createdBy, ...fields} = note
        setDraft(fields)
    }
    function add() {
        const viewport = {x: Math.round(surface.current?.parentElement?.scrollLeft ?? 0), y: Math.round(surface.current?.parentElement?.scrollTop ?? 0)}
        let spot = {x: Math.min(1200, viewport.x + 40), y: Math.min(700, viewport.y + 40)}
        const candidates = Array.from({length: 25}, (_, index) => ({x: 40 + (index % 5) * 280, y: 40 + Math.floor(index / 5) * 190}))
        const vacant = candidates.sort((a, b) => Math.hypot(a.x - viewport.x, a.y - viewport.y) - Math.hypot(b.x - viewport.x, b.y - viewport.y)).find(point => notes.every(note => point.x + 250 <= note.x || point.x >= note.x + note.width + 10 || point.y + 190 <= note.y || point.y >= note.y + note.height + 10))
        if (vacant) spot = vacant
        setDraft({id: '', revision: 0, text: '', color: 'sand', width: 240, height: 180,
            ...spot})
    }
    return <section className="canvas-panel" aria-label="Свободная доска">
        <div className="work-toolbar"><button className="primary" disabled={busy} onClick={add}>+ Заметка</button><p>Общая доска сотрудников · {notes.length}/100 заметок</p></div>
        <p className="work-help">Все сотрудники видят и редактируют эти заметки. Двигайте за ручку. С клавиатуры: Пробел — взять, стрелки — двигать, Shift — шаг 50, Enter — сохранить, Escape — отменить. Прокручивайте поверхность, чтобы увидеть остальные области.</p>
        {draft && <form className="work-form" onSubmit={async function save(event) {event.preventDefault(); if (await run('canvasSave', draft)) setDraft(null)}}><fieldset disabled={busy}>
            <h3>{draft.id ? 'Редактировать заметку' : 'Новая заметка'}</h3>
            {draft.id && board.notes[draft.id]?.revision != draft.revision && <p role="status">Заметка изменилась. Ваш текст сохранён в форме; откройте свежую версию перед повторным сохранением.</p>}
            <label>Текст заметки<textarea required rows={4} maxLength={2000} value={draft.text} onChange={function text(event) {setDraft({...draft, text: event.target.value})}}/></label>
            <div className="work-row"><label>Цвет заметки<select value={draft.color} onChange={function color(event) {setDraft({...draft, color: event.target.value as CanvasNote['color']})}}>{NOTE_COLORS.map(color => <option key={color} value={color}>{colorNames[color]}</option>)}</select></label>
                <label>Ширина заметки<input type="number" min={180} max={420} step={1} value={draft.width} onChange={function width(event) {setDraft({...draft, width: Number(event.target.value)})}}/></label>
                <label>Высота заметки<input type="number" min={120} max={400} step={1} value={draft.height} onChange={function height(event) {setDraft({...draft, height: Number(event.target.value)})}}/></label></div>
            <button className="primary">Сохранить заметку</button> <button type="button" onClick={function cancel() {setDraft(null)}}>Отмена</button>
        </fieldset></form>}
        {notes.length > 1 && <form className="work-toolbar canvas-connect" onSubmit={async function connect(event) {event.preventDefault(); await run('canvasConnect', {from, to})}}>
            <label>От заметки<select value={from} onChange={function source(event) {setFrom(event.target.value)}}><option value="">Выбрать</option>{notes.map(note => <option key={note.id} value={note.id}>{note.text.slice(0, 55)}</option>)}</select></label>
            <span aria-hidden="true">→</span><label>К заметке<select value={to} onChange={function target(event) {setTo(event.target.value)}}><option value="">Выбрать</option>{notes.map(note => <option key={note.id} value={note.id}>{note.text.slice(0, 55)}</option>)}</select></label>
            <button disabled={busy || !board.notes[from] || !board.notes[to] || from == to}>Связать заметки</button>
        </form>}
        <div className="canvas-scroll" onWheel={presence.interact}><div className="canvas-surface" ref={surface} style={CANVAS_SIZE}>
            <svg className="canvas-links" width={CANVAS_SIZE.width} height={CANVAS_SIZE.height} aria-hidden="true"><defs><marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#6e8a82"/></marker></defs>
                {Object.values(board.links).map(link => {const a = board.notes[link.from], b = board.notes[link.to]; return a && b ? <line key={link.id} x1={a.x + a.width / 2} y1={a.y + a.height / 2} x2={b.x + b.width / 2} y2={b.y} markerEnd="url(#canvas-arrow)"/> : null})}
            </svg>
            {notes.map(note => <Note key={note.id} note={note} busy={busy} run={run} presence={presence} edit={edit}/>)}
            {presence.others.map(person => {const drag = person.drag; const note = drag?.kind == 'note' ? board.notes[drag.id] : null; return note && drag ? <div key={person.id} className={'canvas-note canvas-ghost ' + note.color} style={{left: drag.x, top: drag.y, width: note.width, height: note.height, borderColor: personColor(person.id)}}><strong>{person.name} перемещает</strong><p>{note.text}</p></div> : null})}
            {!notes.length && <div className="canvas-empty"><h3>Место для общих идей</h3><p>Добавьте заметку, расположите её на доске и свяжите с другой.</p></div>}
        </div></div>
        {!!Object.keys(board.links).length && <details className="canvas-link-list"><summary>Связи · {Object.keys(board.links).length}</summary>{Object.values(board.links).map(link => <div key={link.id}><span>{board.notes[link.from]?.text.slice(0, 45)} → {board.notes[link.to]?.text.slice(0, 45)}</span><button disabled={busy} onClick={function unlink() {void run('canvasUnlink', {id: link.id})}}>Убрать связь</button></div>)}</details>}
    </section>
}

function Note({note, busy, run, presence, edit}: {note: CanvasNote, busy: boolean, run: tRun, presence: Presence, edit: (note: CanvasNote) => void}) {
    const element = useRef<HTMLElement>(null)
    const base = useRef<CanvasNote | null>(null)
    const generation = useRef(0)
    const scrollStart = useRef({x: 0, y: 0})
    const point = useRef({x: note.x, y: note.y})
    const [notice, setNotice] = useState('')
    const enabled = !busy && presence.phase == 'ready'
    function start() {
        base.current = {...note}
        generation.current = presence.generation
        scrollStart.current = scrollPosition()
        point.current = {x: note.x, y: note.y}
        setNotice('')
        presence.interact()
        presence.update({selected: note.id, drag: {kind: 'note', id: note.id, revision: note.revision, ...point.current}})
    }
    function preview(position: {x: number, y: number}) {
        const original = base.current
        if (!original) return
        point.current = notePosition({...original, x: position.x, y: position.y})
        if (element.current) element.current.style.transform = `translate(${point.current.x - original.x}px, ${point.current.y - original.y}px)`
        presence.update({drag: {kind: 'note', id: original.id, revision: original.revision, ...point.current}})
    }
    function clear() {
        base.current = null
        if (element.current) element.current.style.transform = ''
        presence.update({drag: null})
    }
    async function commit() {
        const original = base.current
        const next = {...point.current}
        clear()
        if (original && (next.x != original.x || next.y != original.y)) {
            if (!await run('canvasMove', {id: original.id, revision: original.revision, ...next})) setNotice('Перемещение не сохранено. Показано актуальное положение.')
        }
    }
    const drag = useDraggableApi({holdMs: 0, trackState: false,
        keyboard: {step: 10, multiplier: 5, modifier: 'shift'},
        enabled,
        onDragStart: start,
        onMove: function move(delta) {
            previewDelta(delta)
            const original = base.current
            const scroll = scrollPosition()
            // Feed the bounded delta back so the next arrow reverses immediately at an edge.
            if (original) drag.setPosition({x: point.current.x - original.x - scroll.x + scrollStart.current.x,
                y: point.current.y - original.y - scroll.y + scrollStart.current.y})
        },
        onDragEnd: function drop(delta) {previewDelta(delta); void commit()},
        onDragCancel: clear,
    })
    const moving = drag.isDragging
    function cancel() {drag.cancelDrag()}
    function scrollPosition() {
        const viewport = element.current?.closest('.canvas-scroll')
        return {x: (viewport?.scrollLeft ?? 0) + window.scrollX, y: (viewport?.scrollTop ?? 0) + window.scrollY}
    }
    function previewDelta(delta: {x: number, y: number}) {
        const scroll = scrollPosition()
        if (base.current) preview({x: base.current.x + delta.x + scroll.x - scrollStart.current.x,
            y: base.current.y + delta.y + scroll.y - scrollStart.current.y})
    }
    useEffect(function changed() {
        if (base.current && (busy || base.current.revision != note.revision || presence.phase != 'ready' || generation.current != presence.generation)) {
            cancel()
            setNotice('Перемещение отменено: состояние или подключение изменилось.')
        }
    }, [busy, note.revision, presence.phase, presence.generation])
    useEffect(function hidden() {
        function cancelHidden() {if (document.hidden) cancel()}
        document.addEventListener('visibilitychange', cancelHidden)
        return function stop() {document.removeEventListener('visibilitychange', cancelHidden)}
    }, [])
    const foreign = presence.others.filter(person => person.drag?.id == note.id)
    return <article className={'canvas-note ' + note.color + (moving ? ' moving' : '')} data-canvas-note={note.id} ref={element}
        style={{left: note.x, top: note.y, width: note.width, height: note.height}} onFocus={function select() {presence.update({selected: note.id})}}
        onPointerMove={function cursor(event) {const r = event.currentTarget.getBoundingClientRect(); presence.update({cursor: {task: note.id, x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height))}})}}
        onPointerLeave={function leave() {presence.update({cursor: null})}}>
        {/* Keep focus during the save round trip; enabled still guards and cancels every input mode. */}
        <button {...drag.handleProps} disabled={false} aria-disabled={!enabled} className="canvas-handle" aria-label={'Переместить заметку: ' + note.text.slice(0, 60)}>
            ⋮⋮ <span>{moving ? 'Перемещение · Esc отменить' : 'Заметка'}</span></button>
        <BoardMarks id={note.id} participants={presence.others}/>
        {!!foreign.length && <small className="canvas-conflict">{moving || foreign.length > 1 ? 'Одновременное перемещение. Сохранится первая актуальная команда.' : foreign.map(person => person.name).join(', ') + ' перемещает'}</small>}
        <p className="canvas-text">{note.text}</p>
        <div className="canvas-actions"><button disabled={busy || moving} onClick={function open() {edit(note)}}>Править</button><button disabled={busy || moving} onClick={function remove() {void run('canvasDelete', {id: note.id, revision: note.revision})}}>Удалить</button></div>
        {notice && <small role="status">{notice}</small>}
    </article>
}
