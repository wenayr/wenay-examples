import React from 'react'
import type {Field, Answers} from '../backend/model'

type tValue = string | number | boolean | undefined

// Видимость поля повторяет правило сервера. Клиент не решает, что принять:
// сервер проверяет тот же набор условий заново.
export function visibleFields(fields: Field[], answers: Answers) {
    const visiting = new Set<string>()
    function visible(field: Field): boolean {
        if (!field.whenField) return true
        if (visiting.has(field.id)) return false
        visiting.add(field.id)
        const parent = fields.find(value => value.id == field.whenField)
        const answered = !!parent && Object.hasOwn(answers, parent.id)
        const matched = answered && String(answers[parent.id]) == field.whenEquals
        const result = !!parent && visible(parent) && matched
        visiting.delete(field.id)
        return result
    }
    return fields.filter(visible)
}

export function cleanAnswers(fields: Field[], answers: Answers): Answers {
    const kept = visibleFields(fields, answers).filter(field => Object.hasOwn(answers, field.id))
    return Object.fromEntries(kept.map(field => [field.id, answers[field.id]]))
}

type QuestionsProps = {
    fields: Field[],
    answers: Answers,
    change: (value: Answers) => void,
    disabled?: boolean
}

export function Questions({fields, answers, change, disabled = false}: QuestionsProps) {
    function set(id: string, value: tValue) {
        const next = {...answers}
        if (value === undefined) delete next[id]
        else next[id] = value
        change(cleanAnswers(fields, next))
    }

    function control(field: Field) {
        const shown = answers[field.id] === undefined ? '' : String(answers[field.id])
        if (field.kind == 'boolean') {
            function pick(event: React.ChangeEvent<HTMLSelectElement>) {
                set(field.id, event.target.value == '' ? undefined : event.target.value == 'true')
            }
            return <select aria-label={field.label} value={shown} required={field.required} disabled={disabled} onChange={pick}>
                <option value="">Выберите ответ</option>
                <option value="true">Да</option>
                <option value="false">Нет</option>
            </select>
        }
        if (field.kind == 'choice') {
            function pick(event: React.ChangeEvent<HTMLSelectElement>) {
                set(field.id, event.target.value || undefined)
            }
            return <select aria-label={field.label} value={shown} required={field.required} disabled={disabled} onChange={pick}>
                <option value="">Выберите вариант</option>
                {field.choices.map(choice => <option key={choice}>{choice}</option>)}
            </select>
        }
        if (field.kind == 'longtext') {
            return <textarea
                aria-label={field.label}
                value={shown}
                required={field.required}
                minLength={field.min}
                maxLength={field.max}
                disabled={disabled}
                rows={3}
                onChange={event => set(field.id, event.target.value)}
            />
        }
        const numeric = field.kind == 'number'
        function type(event: React.ChangeEvent<HTMLInputElement>) {
            if (!numeric) return set(field.id, event.target.value)
            set(field.id, event.target.value == '' ? undefined : Number(event.target.value))
        }
        return <input
            aria-label={field.label}
            type={numeric ? 'number' : 'text'}
            step={numeric ? 'any' : undefined}
            min={numeric ? field.min : undefined}
            max={numeric ? field.max : undefined}
            minLength={field.kind == 'text' ? field.min : undefined}
            maxLength={field.kind == 'text' ? field.max : undefined}
            value={shown}
            required={field.required}
            disabled={disabled}
            onChange={type}
        />
    }

    return <div className="questions">
        {visibleFields(fields, answers).map((field, index) => (
            <label key={field.id}>
                <span>
                    <small>{String(index + 1).padStart(2, '0')}</small>
                    {field.label}
                    {field.required && <em aria-label="Обязательный вопрос"> *</em>}
                </span>
                {control(field)}
            </label>
        ))}
    </div>
}
