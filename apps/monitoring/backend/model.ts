import {hashSecret, type tSecret} from './identity'
import type {TaskState} from '../organizer/task-model'

export const ROLES = ['owner', 'oncall', 'observer'] as const
export type tRole = typeof ROLES[number]
export type Account = {account: string, name: string, secret: tSecret}
export type Organization = {id: string, name: string, revision: number, members: Record<string, tRole | 'probe'>}
export type Preset = {id: string, name: string}
export type Observation = {attempt: number, at: number, outcome: 'up' | 'down' | 'unknown', latencyMs: number, code: number, detail: string}
export type Monitor = {
    id: string, orgId: string, name: string, presetId: string, preferred: string, public: boolean, paused: boolean,
    intervalMs: number, timeoutMs: number, downThreshold: number, upThreshold: number, revision: number,
    nextAt: number, attempt: number, lastAt: number, lastWorker: string, status: 'up' | 'down' | 'unknown', failures: number, successes: number,
    claim: {owner: string, attempt: number, until: number, startedAt: number} | null, history: Observation[], incidentId: string
}
export type Incident = {id: string, orgId: string, monitorId: string, title: string, openedAt: number, closedAt: number,
    status: 'open' | 'acknowledged' | 'resolved', revision: number, acknowledgedBy: string, notes: {id: string, account: string, body: string, at: number}[]}
export type Notice = {id: string, orgId: string, account: string, incidentId: string, title: string, at: number, read: boolean}
export type MonitoringState = {accounts: Record<string, Account>, organizations: Record<string, Organization>, presets: Preset[],
    monitors: Record<string, Monitor>, incidents: Record<string, Incident>, notices: Notice[], quiet: Record<string, boolean>,
    audit: {id: string, orgId: string, account: string, action: string, target: string, at: number}[], workspaces?: Record<string, TaskState>}

export function createMonitoringState(deps: {presets?: Preset[]} = {}): MonitoringState {
    const names = {
        owner: 'Алексей · владелец',
        oncall: 'Даша · дежурная',
        observer: 'Наблюдатель',
        outsider: 'Другая команда',
        'probe-a': 'Обработчик A',
        'probe-b': 'Обработчик B'
    }
    return {accounts: Object.fromEntries(Object.entries(names).map(([account, name]) => [account, {account, name, secret: hashSecret(account + '-pass')}])),
        organizations: {
            northstar: {
                id: 'northstar',
                name: 'Northstar Studio',
                revision: 1,
                members: {
                    owner: 'owner', oncall: 'oncall', observer: 'observer',
                    'probe-a': 'probe', 'probe-b': 'probe'
                }
            },
            harbor: {id: 'harbor', name: 'Harbor Labs', revision: 1, members: {outsider: 'owner'}}
        },
        presets: deps.presets ?? [], monitors: {}, incidents: {}, notices: [], quiet: {}, audit: []}
}
