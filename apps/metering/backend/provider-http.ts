import express, {type Express} from 'express'
import {ProviderUnavailable, type createBillingResource} from './webhook-resource'

// Provider authentication signs raw bytes, before any JSON normalization.
type Receive = ReturnType<typeof createBillingResource>['receive']

export function mountProviderEvents(deps: {app: Express, receive: Receive}) {
    const body = express.raw({type: 'application/json', limit: '8kb'})
    deps.app.post('/api/provider/events', body, async function providerEvent(request, response) {
        try {
            const signature = String(request.headers['x-provider-signature'] ?? '')
            response.json({ok: true, value: await deps.receive(request.body, signature)})
        } catch (error) {
            const status = error instanceof ProviderUnavailable ? 503 : 400
            const message = error instanceof Error ? error.message : 'Событие отклонено'
            response.status(status).json({ok: false, error: message})
        }
    })
}
