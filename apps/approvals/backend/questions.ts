import {buildInputValidate, type tInputSchema} from 'wenay-common2/service'
import type {Field, Answers} from './model'
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
export function validateAnswers(version: {fields: Field[]}, input: unknown): Answers {
    if (!input || typeof input != 'object' || Array.isArray(input) || Object.keys(input).some(key => forbiddenKeys.has(key))) throw new Error('Ожидается объект ответов')
    const values = input as Answers
    const fields = new Map(version.fields.map(field => [field.id, field]))
    const visibility = new Map<string, boolean>()
    function visible(field: Field): boolean {
        if (visibility.has(field.id)) return visibility.get(field.id)!
        const parent = field.whenField ? fields.get(field.whenField)! : null
        const result = !parent || visible(parent) && Object.hasOwn(values, parent.id) && String(values[parent.id]) == field.whenEquals
        visibility.set(field.id, result)
        return result
    }
    const schema: tInputSchema = {}
    for (const field of version.fields.filter(visible)) {
        schema[field.id] = field.kind == 'choice' ? {enum: field.choices, ...(!field.required ? {optional: true as const} : {})} :
            field.kind == 'number' ? (field.required ? 'number' : 'number?') : field.kind == 'boolean' ? (field.required ? 'boolean' : 'boolean?') : (field.required ? 'string' : 'string?')
    }
    buildInputValidate(schema)(input)
    const result: Answers = {}
    for (const field of version.fields.filter(visible)) {
        if (!Object.hasOwn(values, field.id) || values[field.id] === undefined) continue
        const value = values[field.id]
        if ((field.kind == 'text' || field.kind == 'longtext') && (typeof value != 'string' || value.length < Math.max(field.min, field.required ? 1 : 0) || value.length > field.max || field.required && !value.trim())) throw new Error('Проверьте длину поля «' + field.label + '»')
        if (field.kind == 'number' && (typeof value != 'number' || value < field.min || value > field.max)) throw new Error('Число за пределами диапазона')
        result[field.id] = value
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 32768) throw new Error('Ответ до 32 KiB')
    return result
}

