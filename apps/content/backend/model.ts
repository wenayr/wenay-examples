import {hashSecret, type tSecret} from './identity'

export const ROLES = ['owner', 'author', 'editor', 'publisher', 'reader'] as const
export const WRITERS = ['owner', 'author', 'editor'] as const
export const REVIEWERS = ['owner', 'editor'] as const
export const PUBLISHERS = ['owner', 'publisher'] as const
export type tRole = typeof ROLES[number]
export type Block = {id: string, kind: 'heading' | 'text' | 'image' | 'quote' | 'button', text: string, assetId: string, href: string}
export type Draft = {title: string, slug: string, blocks: Block[]}
export type Snapshot = Draft & {version: number, draftRevision: number, createdAt: number, author: string}
export type Review = {version: number, editor: string, at: number, decision: 'approved' | 'changes', body: string}
export type Comment = {id: string, version: number, blockId: string, author: string, body: string, at: number}
export type Publication = {id: string, version: number, at: number, actor: string, kind: 'publish' | 'rollback' | 'scheduled'}
export type Schedule = {
    id: string, version: number, draftRevision: number, dueAt: number, actor: string,
    status: 'pending' | 'cancelled' | 'published' | 'failed', reason: string
}
export type Page = {
    id: string, orgId: string, author: string, revision: number, draftRevision: number,
    draft: Draft, snapshots: Snapshot[], reviews: Review[], comments: Comment[],
    publications: Publication[], schedules: Schedule[], publishedVersion: number,
    publicationRevision: number, createdAt: number, updatedAt: number
}
export type Asset = {
    id: string, orgId: string, hash: string, name: string, alt: string,
    mime: 'image/png' | 'image/jpeg' | 'image/webp', size: number, author: string,
    revision: number, createdAt: number, removedAt: number
}
export type Receipt = {id: string, revision: number, version: number, fresh: boolean}
export type ContentState = {
    accounts: Record<string, {account: string, name: string, secret: tSecret}>,
    organizations: Record<string, {id: string, name: string, members: Record<string, tRole>}>,
    pages: Record<string, Page>,
    assets: Record<string, Asset>,
    intents: Record<string, {signature: string, receipt: Receipt}>,
    audit: {id: string, orgId: string, actor: string, action: string, target: string, at: number}[]
}

const DEMO_NAMES: Record<string, string> = {
    owner: 'Мария',
    author: 'Анна',
    editor: 'Илья',
    publisher: 'Олег',
    reader: 'Гость',
    outsider: 'Harbor'
}
export function createContentState(): ContentState {
    const accounts = Object.fromEntries(Object.keys(DEMO_NAMES).map(function demoAccount(account) {
        return [account, {account, name: DEMO_NAMES[account], secret: hashSecret(account + '-pass')}]
    }))
    const page: Page = {id: 'welcome', orgId: 'northstar', author: 'author', revision: 1, draftRevision: 1,
        draft: {
            title: 'Добро пожаловать в Northstar',
            slug: 'welcome',
            blocks: [
                {
                    id: 'intro', kind: 'heading',
                    text: 'Истории, которые хочется читать', assetId: '', href: ''
                },
                {
                    id: 'body', kind: 'text',
                    text: 'Это рабочий черновик. Его увидят читатели после согласования и публикации.',
                    assetId: '', href: ''
                }
            ]
        },
        snapshots: [], reviews: [], comments: [], publications: [], schedules: [], publishedVersion: 0, publicationRevision: 0, createdAt: 0, updatedAt: 0}
    const members: Record<string, tRole> = {
        owner: 'owner', author: 'author', editor: 'editor',
        publisher: 'publisher', reader: 'reader'
    }
    const northstar = {id: 'northstar', name: 'Northstar Journal', members}
    const harbor = {
        id: 'harbor',
        name: 'Harbor Stories',
        members: {outsider: 'owner'} as Record<string, tRole>
    }
    return {
        accounts,
        organizations: {northstar, harbor},
        pages: {welcome: page},
        assets: {},
        intents: {},
        audit: []
    }
}
