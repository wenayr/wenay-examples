export const TEST_PLANS = {starter: {monthlyUnits: 1000, concurrent: 2}, team: {monthlyUnits: 5000, concurrent: 5}} as const
export type ProviderSnapshot = {orgId: string, version: number, plan: keyof typeof TEST_PLANS, status: 'active' | 'cancelled'}
export type Subscription = ProviderSnapshot & {updatedAt: number}
export type WebhookEndpoint = {id: string, orgId: string, url: string, secret: string, enabled: boolean, createdAt: number}
export type WebhookDelivery = {
    id: string, orgId: string, endpointId: string, type: 'usage.committed' | 'subscription.updated',
    payload: {id: string, type: string, orgId: string, data: Record<string, string | number>},
    status: 'pending' | 'sending' | 'delivered' | 'failed', nextAt: number, createdAt: number,
    batchAttempt: number, manualRetries: number,
    attempts: {number: number, at: number, httpStatus: number, error: string}[]
}
export type BillingState = {
    subscriptions?: Record<string, Subscription>,
    providerEvents?: Record<string, {id: string, orgId: string, notifiedVersion: number, appliedVersion: number, at: number}>,
    webhooks?: Record<string, WebhookEndpoint>, deliveries?: Record<string, WebhookDelivery>
}
