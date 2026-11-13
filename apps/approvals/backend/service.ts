import type {tServiceDefinition} from 'wenay-common2/service'
import {createApprovalState, type ApprovalState} from './model'
import {createApprovalDomain, approvalRoles} from './domain'
import {verifySecret} from './identity'

type Credentials = {account: string, password: string}

// Демонстрационный вход по паролю из состояния. Внешнего провайдера
// подключают заменой этого resolve, определение сервиса не меняется.
function resolve(state: ApprovalState, input: Credentials) {
    const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
    return verifySecret(account?.secret, input.password) ? input.account : null
}

export function createApprovalService(deps: {now?: () => number} = {}) {
    // `as const` обязателен: схема входа выводится из литералов, без него
    // 'string' расширяется до string и определение перестаёт подходить под контракт.
    const access = {
        rolesOf: approvalRoles,
        login: {input: {account: 'string', password: 'string'} as const, resolve}
    }
    const definition = {
        name: 'approvals',
        storeId: 'approvals-store',
        originId: 'approvals-origin',
        version: 1,
        initial: createApprovalState(),
        limits: {perMinute: 120},
        access,
        ...createApprovalDomain(deps)
    } satisfies tServiceDefinition<ApprovalState>
    return {definition}
}
