import {timingSafeEqual} from 'node:crypto'
import type {tServiceDefinition} from 'wenay-common2/service'
import {createFormsState, type FormsState} from './model'
import {createFormsDomain, formsRoles, hash} from './domain'
import {verifySecret} from './identity'

export function createFormsService(deps: {now?: () => number} = {}) {
    const domain = createFormsDomain(deps)
    return {definition: {name: 'forms', storeId: 'forms-store', originId: 'forms-origin', version: 1, limits: {perMinute: 120}, initial: createFormsState(),
        access: {rolesOf: formsRoles, login: {
            input: {account: 'string', password: 'string'},
            resolve(state: FormsState, input: {account: string, password: string}) {
            if (input.account == 'respondent') {
                if (!/^[\w-]{43}$/.test(input.password)) return null
                const digest = Buffer.from(hash(input.password), 'hex')
                function published(form: {enabled: boolean, tokenHash: string}) {
                    if (!form.enabled || form.tokenHash.length != 64) return false
                    return timingSafeEqual(digest, Buffer.from(form.tokenHash, 'hex'))
                }
                const form = Object.values(state.forms).find(published)
                return form ? 'form:' + form.id + ':' + form.accessGeneration : null
            }
            const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
            return verifySecret(account?.secret, input.password) ? input.account : null
        }}}, ...domain} satisfies tServiceDefinition<FormsState>}
}
export const formsDefinition = createFormsService().definition
