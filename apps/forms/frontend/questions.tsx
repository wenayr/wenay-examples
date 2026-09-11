import React from 'react'
import type {Field, Answers} from '../backend/model'

export function visibleFields(fields: Field[], answers: Answers) {
    const visiting = new Set<string>()
    // Условие может ссылаться на условие: цикл обрываем, считая поле скрытым.
    function visible(field: Field): boolean {
        if (!field.whenField) return true
        if (visiting.has(field.id)) return false
        visiting.add(field.id)
        const parent = fields.find(value => value.id == field.whenField)
        const answered = !!parent && Object.hasOwn(answers, parent.id)
        const result = answered && visible(parent) && String(answers[parent.id]) == field.whenEquals
        visiting.delete(field.id)
        return result
    }
    return fields.filter(visible)
}

export function cleanAnswers(fields: Field[], answers: Answers): Answers {
    const shown = visibleFields(fields, answers).filter(field => Object.hasOwn(answers, field.id))
    return Object.fromEntries(shown.map(field => [field.id, answers[field.id]]))
}

type QuestionsProps = {
    fields: Field[],
    answers: Answers,
    change: (value: Answers) => void,
    disabled?: boolean
}

export function Questions({fields, answers, change, disabled = false}: QuestionsProps) {
    function set(id: string, value: string | number | boolean | undefined) {
        const next = {...answers}
        if (value === undefined) delete next[id]
        else next[id] = value
        change(cleanAnswers(fields, next))
    }

    function control(field: Field) {
        const text = String(answers[field.id] ?? '')
        if (field.kind == 'boolean') {
            const value = Object.hasOwn(answers, field.id) ? String(answers[field.id]) : ''
            return <select
                aria-label={field.label}
                value={value}
                required={field.required}
                disabled={disabled}
                onChange={event => set(field.id, event.target.value == '' ? undefined : event.target.value == 'true')}
            >
                <option value="">Выберите ответ</option>
                <option value="true">Да</option>
                <option value="false">Нет</option>
            </select>
        }
        if (field.kind == 'choice') {
            return <select
                aria-label={field.label}
                value={text}
                required={field.required}
                disabled={disabled}
                onChange={event => set(field.id, event.target.value || undefined)}
            >
                <option value="">Выберите вариант</option>
                {field.choices.map(choice => <option key={choice}>{choice}</option>)}
            </select>
        }
        if (field.kind == 'longtext') {
            return <textarea
                aria-label={field.label}
                value={text}
                required={field.required}
                minLength={field.min}
                maxLength={field.max}
                disabled={disabled}
                rows={3}
                onChange={event => set(field.id, event.target.value)}
            />
        }
        const numeric = field.kind == 'number'
        function typed(value: string) {
            if (!numeric) return value
            return value == '' ? undefined : Number(value)
        }
        return <input
            aria-label={field.label}
            type={numeric ? 'number' : 'text'}
            step={numeric ? 'any' : undefined}
            min={numeric ? field.min : undefined}
            max={numeric ? field.max : undefined}
            minLength={field.kind == 'text' ? field.min : undefined}
            maxLength={field.kind == 'text' ? field.max : undefined}
            value={answers[field.id] === undefined ? '' : String(answers[field.id])}
            required={field.required}
            disabled={disabled}
            onChange={event => set(field.id, typed(event.target.value))}
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
