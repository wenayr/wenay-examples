import {useEffect, useId, useState, type KeyboardEvent} from 'react'
import type {FlightAirport} from '../../src/airport-contract.ts'
import {directoryUrl, useDirectoryQuery} from '../directory-query.ts'
import './airports.css'

interface AirportPickerProps {
    label: string
    value: string
    onChange: (code: string) => void
    onSelect?: (airport: FlightAirport) => void
    initialText?: string
    autoOpen?: boolean
}

function locality(port: FlightAirport) {
    return [...new Set([port.city, port.region, port.country].filter(Boolean))].join(', ')
}

function manualCode(input: string) {
    const code = input.trim().toUpperCase()
    return /^[A-Z]{3}$/.test(code) ? code : ''
}

export function AirportPicker({label, value, onChange, onSelect, initialText, autoOpen = false}: AirportPickerProps) {
    const inputId = useId()
    const listId = inputId + '-list'
    const [entry, setEntry] = useState(() => ({value, text: initialText || value}))
    const [picked, setPicked] = useState<FlightAirport | null>(null)
    const [open, setOpen] = useState(autoOpen)
    const [active, setActive] = useState(-1)
    const text = value == entry.value ? entry.text : value
    const term = text.trim()
    const identified = picked?.iata == value ? picked : undefined
    const [debounced, setDebounced] = useState(term)
    useEffect(() => {
        if (debounced == term) return
        const timer = setTimeout(() => setDebounced(term), 160)
        return () => clearTimeout(timer)
    }, [term, debounced])
    const searching = open && Boolean(term)
    const settled = searching && debounced == term
    const resolveCode = !open && !identified && manualCode(value) != ''
    const lookup = settled || resolveCode
    const phrase = settled ? debounced : value
    const url = lookup ? directoryUrl('airports', {q: phrase, limit: 12}) : null
    const {data, error, retry} = useDirectoryQuery<{items: FlightAirport[]}>(url)
    const items = settled ? data?.items ?? [] : []
    const selected = identified ?? data?.items.find(port => port.iata == value)
    const visible = searching && items.length > 0
    const highlighted = visible && active >= 0 && active < items.length
    function change(input: string) {
        const code = manualCode(input)
        setEntry({value: code, text: input})
        setPicked(null)
        setActive(-1)
        setOpen(true)
        onChange(code)
    }
    function select(port: FlightAirport) {
        setPicked(port)
        setEntry({value: port.iata, text: port.iata})
        setOpen(false)
        setActive(-1)
        onChange(port.iata)
        onSelect?.(port)
    }
    function keyboard(event: KeyboardEvent<HTMLInputElement>) {
        if (event.nativeEvent.isComposing) return
        if (event.key == 'Escape') {
            if (open) event.preventDefault()
            setOpen(false)
            setActive(-1)
            return
        }
        if (event.key == 'ArrowDown' || event.key == 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            if (items.length) {
                const step = event.key == 'ArrowDown' ? 1 : -1
                const current = active < 0 && step == -1 ? 0 : active
                setActive((current + step + items.length) % items.length)
            }
        } else if (event.key == 'Enter' && highlighted) {
            event.preventDefault()
            select(items[active])
        } else if (event.key == 'Enter' && open && onSelect) {
            const exact = items.find(port => port.iata == value)
            if (exact) {
                event.preventDefault()
                select(exact)
            }
        }
    }
    useEffect(() => {
        if (highlighted) document.getElementById(listId + '-' + active)?.scrollIntoView({block: 'nearest'})
    }, [highlighted, active, listId])
    return <div className={'airport-picker' + (autoOpen ? ' airport-picker-inline' : '')}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
        <label htmlFor={inputId}>{label}</label>
        <input id={inputId} type="text" role="combobox" aria-autocomplete="list" aria-controls={listId}
            aria-expanded={visible} aria-activedescendant={highlighted ? listId + '-' + active : undefined}
            value={text} maxLength={120} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Город, штат, название или IATA"
            onChange={event => change(event.target.value)} onFocus={() => setOpen(true)} onKeyDown={keyboard}/>
        {!open && selected && <small className="airport-selected">{selected.name} · {locality(selected)}</small>}
        <div className="airport-popup" hidden={!searching}>
            <ul id={listId} role="listbox" aria-label={label}>{items.map((port, index) =>
                <li id={listId + '-' + index} role="option" aria-selected={index == active} key={port.iata}
                    onMouseDown={event => event.preventDefault()} onClick={() => select(port)}>
                    <b>{port.iata}</b><span><strong>{port.name}</strong><small>{locality(port)}</small></span>
                </li>)}</ul>
            {searching && !data && !error && <p role="status">Ищем аэропорты…</p>}
            {settled && error && <p role="status">Справочник недоступен. Можно ввести код IATA.{' '}
                <button type="button" onClick={retry}>Повторить</button></p>}
            {settled && data && !data.items.length && <p role="status">Аэропорты не найдены. Уточните название или введите код IATA.</p>}
        </div>
    </div>
}
