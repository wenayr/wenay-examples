import {createDocumentService} from './service'
import {createProductCredentials} from './product-credentials'
import {organizationAccess} from './domain'
import {createDocumentProcessing, type DocumentProcessor, type DocumentExecutor} from './processing-resource'
import type {Store} from 'wenay-common2/observe'
import type {DocumentState} from './model'
import type {UsageGate} from './metered-execution'
import type {ExtractionProvider} from './model-extraction'

type RuntimeOptions = {
    now?: () => number,
    directory?: string,
    processor?: DocumentProcessor,
    python?: string,
    usage?: UsageGate,
    extractor?: ExtractionProvider
}

export function createDocumentRuntime(deps: RuntimeOptions = {}) {
    const definition = createDocumentService(deps).definition
    const credentials = createProductCredentials({now: deps.now, authorizeOwner(state, account, orgId) {
        return organizationAccess(state, account, orgId, ['owner'])
    }})
    const processing = createDocumentProcessing(deps)
    type CredentialExecutor = Parameters<typeof credentials.mount>[0]['execute']
    return {definition: {...definition, commands: {...definition.commands, ...credentials.commands}, resources: {
        processor: processing.resource, productKeys: credentials.resource, productDocuments: processing.productResource
    }},
        mount(input: {store: Store<DocumentState>, execute: DocumentExecutor & CredentialExecutor}) {
            const closeCredentials = credentials.mount(input)
            const closeProcessing = processing.mount(input)
            return function close() {
                closeProcessing()
                closeCredentials()
            }
        },
        view: processing.view}
}
export type DocumentDefinition = ReturnType<typeof createDocumentRuntime>['definition']
