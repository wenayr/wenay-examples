// Канон: shared/backend/metering-contract.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import type {InferInput, ServiceCommandCtx, ServiceResourceContext, tServiceDefinition} from 'wenay-common2/service'

export type UsageReceipt = {
    id: string, eventId: string, orgId: string, status: 'reserved' | 'committed' | 'released' | 'unknown',
    period: string, units: number, reservedUnits: number, fresh: boolean
}
export type UsageIdentity = {orgId: string, keyId: string, scopes: ('usage:read' | 'usage:write')[], expiresAt: number}

const event = {eventId: 'string', metric: {enum: ['search', 'document']}, units: 'number', reference: 'string'} as const
const reason = {eventId: 'string', reason: 'string'} as const

// One source for authority validation and the small, copyable consumer contract.
export const USAGE_INPUTS = {
    usageRecord: event,
    usageReserve: event,
    usageSettle: {eventId: 'string', units: 'number'},
    usageRelease: reason,
    usageUncertain: reason
} as const

// This is a type-only facade; it does not manufacture executable server handlers.
export type MeteringUsageDefinition = tServiceDefinition<Record<string, never>, {
    [K in keyof typeof USAGE_INPUTS]: {
        apply: (ctx: ServiceCommandCtx<Record<string, never>>, input: InferInput<typeof USAGE_INPUTS[K]>) => UsageReceipt
    }
}> & {resources: {usage: {
    allow: readonly string[], placement: 'authority',
    open: (ctx: ServiceResourceContext) => {facade: {control: {identity: () => UsageIdentity}}, close: () => void}
}}}
