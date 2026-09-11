import type {tServiceDefinition} from 'wenay-common2/service'
import {createBookingState, type BookingState} from './model'
import {createBookingDomain, bookingRoles} from './domain'
import {verifySecret} from './identity'

export function createBookingService(deps: {now?: () => number, holdMs?: number} = {}) {
    const domain = createBookingDomain(deps)
    return {definition: {
        name: 'booking', storeId: 'booking-store', originId: 'booking-origin', version: 1, limits: {perMinute: 120},
        initial: createBookingState(),
        access: {rolesOf: bookingRoles, login: {
            input: {account: 'string', password: 'string'},
            resolve(state: BookingState, input: {account: string, password: string}) {
            const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
            return verifySecret(account?.secret, input.password) ? input.account : null
        }}},
        ...domain
    } satisfies tServiceDefinition<BookingState>}
}
export const bookingDefinition = createBookingService().definition
