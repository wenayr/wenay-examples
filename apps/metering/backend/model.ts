import {hashSecret, type tSecret} from './identity'
import type {BillingState} from './billing-model'

export const SCOPES = ['usage:read', 'usage:write'] as const
export type tScope = typeof SCOPES[number]
export type ApiKey = {id: string, orgId: string, label: string, hash: string, scopes: tScope[], createdBy: string, createdAt: number, expiresAt: number, revokedAt: number}
export type UsageEvent = {
    id: string, eventId: string, orgId: string, keyId: string, metric: 'search' | 'document', reference: string,
    period: string, units: number, reservedUnits: number, signature: string,
    status: 'reserved' | 'committed' | 'released' | 'unknown', reason: string, createdAt: number, updatedAt: number
}
export type UsagePeriod = {orgId: string, period: string, used: number, reserved: number, active: number}
export type MeteringState = BillingState & {
    accounts: Record<string, {account: string, name: string, secret: tSecret}>,
    organizations: Record<string, {id: string, name: string, members: Record<string, 'owner' | 'auditor'>, monthlyUnits: number, concurrent: number}>,
    keys: Record<string, ApiKey>, events: Record<string, UsageEvent>, periods: Record<string, UsagePeriod>,
    audit: {orgId: string, actor: string, action: string, id: string, at: number}[]
}

export const DEMO_LOGINS = {owner: 'owner-pass', auditor: 'auditor-pass', outsider: 'outsider-pass'} as const
export function createMeteringState(): MeteringState {
    return {
        accounts: Object.fromEntries(Object.keys(DEMO_LOGINS).map(account => [account, {account,
            name: ({owner: 'Алексей · владелец', auditor: 'Мария · аудит', outsider: 'Никита · другая команда'} as Record<string, string>)[account], secret: hashSecret(account + '-pass')} ])),
        organizations: {
            northstar: {id: 'northstar', name: 'Northstar Studio', members: {owner: 'owner', auditor: 'auditor'}, monthlyUnits: 1000, concurrent: 2},
            harbor: {id: 'harbor', name: 'Harbor Labs', members: {outsider: 'owner'}, monthlyUnits: 100, concurrent: 1}
        }, keys: {}, events: {}, periods: {}, audit: []
    }
}
