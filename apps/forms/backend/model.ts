import {hashSecret, type tSecret} from './identity'

export const STAFF = ['owner', 'author', 'analyst'] as const
export type tStaffRole = typeof STAFF[number]
export const FIELD_TYPES = ['text', 'longtext', 'number', 'choice', 'boolean'] as const
export type tFieldType = typeof FIELD_TYPES[number]
export type tAnswer = string | number | boolean
export type Answers = Record<string, tAnswer>
export type Field = {
    id: string, label: string, kind: tFieldType, required: boolean, choices: string[],
    min: number, max: number, whenField: string, whenEquals: string
}
export type PublishedVersion = {version: number, title: string, description: string, fields: Field[], publishedAt: number}
export type Form = {id: string, orgId: string, title: string, description: string, fields: Field[], revision: number,
    versions: PublishedVersion[], publishedVersion: number, enabled: boolean, accessGeneration: number, tokenHash: string,
    retentionDays: number, answersRevision: number, createdAt: number}
export type Submission = {id: string, formId: string, orgId: string, version: number, answers: Answers, createdAt: number, expiresAt: number}
export type SubmissionReceipt = {id: string, formId: string, version: number, signature: string, deleted: boolean}
export type FieldAggregate = {answered: number, sum: number, values: Record<string, number>}
export type Aggregate = {formId: string, version: number, count: number, fields: Record<string, FieldAggregate>}
export type Organization = {id: string, name: string, revision: number, members: Record<string, tStaffRole>}
export type FormsState = {
    accounts: Record<string, {account: string, name: string, secret: tSecret}>, organizations: Record<string, Organization>,
    forms: Record<string, Form>, submissions: Record<string, Submission>, receipts: Record<string, SubmissionReceipt>, aggregates: Record<string, Aggregate>,
    publications?: Record<string, {orgId: string, formId: string, revision: number, version: number}>, erasureRevision?: number
}
export const DEMO_LOGINS = {owner: 'owner-pass', author: 'author-pass', analyst: 'analyst-pass', outsider: 'outsider-pass'} as const
export function createFormsState(): FormsState {
    const fields: Field[] = [
        {id: 'rating', label: 'Как вам наш продукт?', kind: 'number', required: true, choices: [], min: 1, max: 5, whenField: '', whenEquals: ''},
        {id: 'recommend', label: 'Порекомендуете нас коллегам?', kind: 'boolean', required: true, choices: [], min: 0, max: 0, whenField: '', whenEquals: ''},
        {
            id: 'details', label: 'Что нам улучшить?', kind: 'longtext', required: true,
            choices: [], min: 1, max: 2000, whenField: 'recommend', whenEquals: 'false'
        }
    ]
    function form(id: string, orgId: string, title: string): Form {
        return {
            id,
            orgId,
            title,
            description: 'Помогите нам выбрать следующий шаг.',
            fields: fields.map(field => ({...field, choices: [...field.choices]})),
            revision: 1,
            versions: [],
            publishedVersion: 0,
            enabled: false,
            accessGeneration: 0,
            tokenHash: '',
            retentionDays: 30,
            answersRevision: 0,
            createdAt: Date.UTC(2026, 8, 10)
        }
    }
    return {
        accounts: Object.fromEntries(Object.keys(DEMO_LOGINS).map(account => [account, {account, name: account, secret: hashSecret(account + '-pass')}])),
        organizations: {northstar: {id: 'northstar', name: 'Northstar Studio', revision: 1, members: {owner: 'owner', author: 'author', analyst: 'analyst'}},
            harbor: {id: 'harbor', name: 'Harbor Labs', revision: 1, members: {outsider: 'owner'}}},
        forms: {'form-feedback': form('form-feedback', 'northstar', 'Как прошёл ваш первый проект?'), 'form-harbor': form('form-harbor', 'harbor', 'Закрытый опрос Harbor')},
        submissions: {}, receipts: {}, aggregates: {}
    }
}
