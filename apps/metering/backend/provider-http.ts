import express, {type Express} from 'express'
import {ProviderUnavailable, type createBillingResource} from './webhook-resource'

// Provider authentication signs raw bytes, before any JSON normalization.
export function mountProviderEvents(deps: {app: Express, receive: ReturnType<typeof createBillingResource>['receive']}) {
    deps.app.post('/api/provider/events', express.raw({type: 'application/json', limit: '8kb'}), async function providerEvent(request, response) {
        try {response.json({ok: true, value: await deps.receive(request.body, String(request.headers['x-provider-signature'] ?? ''))})}
        catch (error) {
            response.status(error instanceof ProviderUnavailable ? 503 : 400).json({ok: false, error: error instanceof Error ? error.message : 'Событие отклонено'})
        }
    })
}
