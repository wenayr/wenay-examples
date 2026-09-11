// Канон: shared/backend/published-contract.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import type {ServiceResourceContext, tServiceDefinition} from 'wenay-common2/service'

// Copyable consumer contract, checked by the publishing authority with satisfies.
export type PublishedBlock = {
    id: string,
    kind: 'heading' | 'text' | 'image' | 'quote' | 'button',
    text: string,
    assetId: string,
    href: string
}

export type PublishedArticle = {
    id: string, orgId: string, version: number, publicationRevision: number,
    title: string, slug: string, blocks: PublishedBlock[], publishedAt: number
}
export type PublishedIndex = Pick<PublishedArticle, 'id' | 'orgId' | 'slug' | 'title' | 'version' | 'publicationRevision'>
export type PublishedFacade = {control: {read(input: {orgId: string, slug: string}): PublishedArticle, list(orgId: string): PublishedIndex[]}}
type PublishedResource = {
    allow: readonly string[],
    placement: 'authority',
    open(ctx: ServiceResourceContext): {facade: PublishedFacade, close(): void}
}

export type PublishedDefinition = tServiceDefinition<Record<string, never>, Record<never, never>> & {
    resources: {published: PublishedResource}
}
