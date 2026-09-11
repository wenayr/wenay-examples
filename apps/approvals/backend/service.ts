import type {tServiceDefinition} from 'wenay-common2/service'
import {createApprovalState, type ApprovalState} from './model'
import {createApprovalDomain, approvalRoles} from './domain'
import {verifySecret} from './identity'
export function createApprovalService(deps: {now?: () => number} = {}) {
    return {definition: {name: 'approvals', storeId: 'approvals-store', originId: 'approvals-origin', version: 1, initial: createApprovalState(), limits: {perMinute: 120},
        access: {rolesOf: approvalRoles, login: {input: {account: 'string', password: 'string'}, resolve(state: ApprovalState, input: {account: string, password: string}) {
            const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
            return verifySecret(account?.secret, input.password) ? input.account : null
        }}}, ...createApprovalDomain(deps)} satisfies tServiceDefinition<ApprovalState>}
}
