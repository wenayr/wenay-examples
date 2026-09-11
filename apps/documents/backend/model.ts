import {hashSecret, type tSecret} from './identity'

export const ROLES = ['owner', 'reviewer', 'uploader'] as const
export type tRole = typeof ROLES[number]
import type {ParsedTable} from './csv-table'
export type {ParsedTable} from './csv-table'
import type {FieldOrigin} from './model-extraction'
export type Provenance = {sourceVersion: number, provider: string, demo: boolean, fields: FieldOrigin[]}
export type DocumentItem = {
    id: string, orgId: string, owner: string, name: string, blobId: string, size: number,
    revision: number, sourceVersion: number, createdAt: number, updatedAt: number,
    status: 'uploaded' | 'processing' | 'review' | 'approved' | 'failed' | 'cancelled' | 'uncertain' | 'deleted',
    processor: string, activeRun: string, attempt: number, error: string,
    table: ParsedTable, provenance?: Provenance, comments: {row: number, text: string, by: string, at: number}[],
    approvals: {revision: number, by: string, at: number, table: ParsedTable, sourceVersion: number, provenance?: Provenance}[]
}
export type DocumentState = {
    accounts: Record<string, {account: string, name: string, secret: tSecret}>,
    organizations: Record<string, {id: string, name: string, members: Record<string, tRole>}>,
    documents: Record<string, DocumentItem>,
    audit: {orgId: string, actor: string, action: string, id: string, at: number}[]
}
export const DEMO_LOGINS = {owner: 'owner-pass', reviewer: 'reviewer-pass', customer: 'customer-pass', outsider: 'outsider-pass'} as const

const DEMO_NAMES: Record<string, string> = {
    owner: 'Алексей · владелец',
    reviewer: 'Мария · проверка',
    customer: 'Илья · загрузка',
    outsider: 'Никита · другая команда'
}

export function createDocumentState(): DocumentState {
    return {
        accounts: Object.fromEntries(Object.keys(DEMO_LOGINS).map(account => [account, {account,
            name: DEMO_NAMES[account], secret: hashSecret(account + '-pass')} ])),
        organizations: {
            northstar: {id: 'northstar', name: 'Northstar Studio', members: {owner: 'owner', reviewer: 'reviewer', customer: 'uploader'}},
            harbor: {id: 'harbor', name: 'Harbor Labs', members: {outsider: 'owner'}}
        },
        documents: {}, audit: []
    }
}
