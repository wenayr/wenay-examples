import type {ServiceResourceContext, tServiceDefinition} from 'wenay-common2/service'

// Copyable consumer contract, checked by the publishing authority with satisfies.
export type PublishedArticle = {id: string, orgId: string, version: number, publicationRevision: number, title: string, slug: string, blocks: {id: string, kind: 'heading' | 'text' | 'image' | 'quote' | 'button', text: string, assetId: string, href: string}[], publishedAt: number}
export type PublishedIndex = Pick<PublishedArticle, 'id' | 'orgId' | 'slug' | 'title' | 'version' | 'publicationRevision'>
export type PublishedFacade = {control: {read(input: {orgId: string, slug: string}): PublishedArticle, list(orgId: string): PublishedIndex[]}}
export type PublishedDefinition = tServiceDefinition<Record<string, never>, Record<never, never>> & {resources: {published: {allow: readonly string[], placement: 'authority', open(ctx: ServiceResourceContext): {facade: PublishedFacade, close(): void}}}}
