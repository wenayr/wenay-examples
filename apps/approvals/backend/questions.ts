import {buildInputValidate, type tInputSchema} from 'wenay-common2/service'
import type {Field, Answers} from './model'

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])

// Схема активных вопросов строится под конкретный набор ответов и проверяется
// публичным buildInputValidate common2: отдельной системы схем в примере нет.
function fieldSchema(field: Field): tInputSchema[string] {
    if (field.kind == 'choice') {
        const optional = field.required ? {} : {optional: true as const}
        return {enum: field.choices, ...optional}
    }
    if (field.kind == 'number') return field.required ? 'number' : 'number?'
    if (field.kind == 'boolean') return field.required ? 'boolean' : 'boolean?'
    return field.required ? 'string' : 'string?'
}

function checkText(field: Field, value: unknown) {
    const least = Math.max(field.min, field.required ? 1 : 0)
    const sized = typeof value == 'string' && value.length >= least && value.length <= field.max
    const filled = !field.required || (typeof value == 'string' && !!value.trim())
    if (!sized || !filled) throw new Error('Проверьте длину поля «' + field.label + '»')
}

function checkNumber(field: Field, value: unknown) {
    const inRange = typeof value == 'number' && value >= field.min && value <= field.max
    if (!inRange) throw new Error('Число за пределами диапазона')
}

export function validateAnswers(version: {fields: Field[]}, input: unknown): Answers {
    const shaped = !!input && typeof input == 'object' && !Array.isArray(input)
    const safe = shaped && !Object.keys(input).some(key => forbiddenKeys.has(key))
    if (!safe) throw new Error('Ожидается объект ответов')
    const values = input as Answers
    const fields = new Map(version.fields.map(field => [field.id, field]))
    const visibility = new Map<string, boolean>()

    // Условие ссылается на другое поле: скрытый вопрос не участвует ни в схеме, ни в ответе.
    function visible(field: Field): boolean {
        if (visibility.has(field.id)) return visibility.get(field.id)!
        const parent = field.whenField ? fields.get(field.whenField)! : null
        let result = true
        if (parent) {
            const answered = Object.hasOwn(values, parent.id)
            result = visible(parent) && answered && String(values[parent.id]) == field.whenEquals
        }
        visibility.set(field.id, result)
        return result
    }

    const active = version.fields.filter(visible)
    const schema: tInputSchema = {}
    for (const field of active) schema[field.id] = fieldSchema(field)
    buildInputValidate(schema)(input)

    const result: Answers = {}
    for (const field of active) {
        if (!Object.hasOwn(values, field.id) || values[field.id] === undefined) continue
        const value = values[field.id]
        if (field.kind == 'text' || field.kind == 'longtext') checkText(field, value)
        if (field.kind == 'number') checkNumber(field, value)
        result[field.id] = value
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 32768) throw new Error('Ответ до 32 KiB')
    return result
}
