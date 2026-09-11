import {documentsDefinition} from './service'
import {createDocumentProcessing, type DocumentProcessor, type DocumentExecutor} from './processing-resource'
import type {Store} from 'wenay-common2/observe'
import type {DocumentState} from './model'
import type {UsageGate} from './metered-execution'
import type {ExtractionProvider} from './model-extraction'

export function createDocumentRuntime(deps: {directory?: string, processor?: DocumentProcessor, python?: string, usage?: UsageGate, extractor?: ExtractionProvider} = {}) {
    const processing = createDocumentProcessing(deps)
    return {definition: {...documentsDefinition, resources: {processor: processing.resource}},
        mount(input: {store: Store<DocumentState>, execute: DocumentExecutor}) {return processing.mount(input)},
        view: processing.view}
}
export type DocumentDefinition = ReturnType<typeof createDocumentRuntime>['definition']
