import {hashSecret, type tSecret} from './identity'

export const ROLES = ['owner', 'staff', 'customer'] as const
export type tRole = typeof ROLES[number]
export type Window = {start: string, end: string}
export type Resource = {
    id: string, orgId: string, name: string, staff: string, zone: string,
    capacity: number, revision: number, weekly: (Window & {day: number})[],
    exceptions: {date: string, windows: Window[]}[]
}
export type Offering = {
    id: string, orgId: string, resourceId: string, name: string, description: string,
    duration: number, before: number, after: number, capacity: number,
    depositUnits: number, active: boolean, revision: number
}
export type Booking = {
    id: string, orgId: string, serviceId: string, resourceId: string, customer: string,
    partySize: number, start: number, end: number, occupiedFrom: number, occupiedTo: number,
    status: 'held' | 'confirmed' | 'cancelled' | 'expired', holdUntil: number, revision: number,
    createdAt: number, updatedAt: number, note: string, depositUnits: number,
    deposit: 'none' | 'pending' | 'paid' | 'failed' | 'refundDue', reminder: boolean
}
export type WaitEntry = {
    id: string, orgId: string, serviceId: string, customer: string, partySize: number,
    start: number, status: 'waiting' | 'offered' | 'accepted' | 'cancelled' | 'expired',
    offerId: string, createdAt: number, updatedAt: number
}
export type Notice = {
    id: string, orgId: string, customer: string, bookingId: string, revision: number,
    dueAt: number, status: 'pending' | 'delivered' | 'cancelled', body: string, deliveredAt: number
}
export type Receipt = {id: string, revision: number, status: string, fresh: boolean}
export type BookingState = {
    accounts: Record<string, {account: string, name: string, secret: tSecret}>,
    organizations: Record<string, {id: string, name: string, members: Record<string, tRole>}>,
    resources: Record<string, Resource>, services: Record<string, Offering>, bookings: Record<string, Booking>, waitlist: Record<string, WaitEntry>,
    notices: Record<string, Notice>, intents: Record<string, {signature: string, result: Receipt}>,
    audit: {id: string, orgId: string, actor: string, action: string, target: string, at: number}[]
}

const DEMO_NAMES = {
    owner: 'Алексей · владелец',
    staff: 'Анна · специалист',
    customer: 'Илья · клиент',
    customer2: 'Дарья · клиент',
    outsider: 'Никита · Harbor'
}

export function createBookingState(): BookingState {
    function resource(id: string, orgId: string, staff: string, zone: string): Resource {
        return {id, orgId, name: orgId == 'northstar' ? 'Студия · Анна' : 'Кабинет Harbor', staff, zone, capacity: 2, revision: 1,
            weekly: [1, 2, 3, 4, 5].map(day => ({day, start: '09:00', end: '18:00'})), exceptions: []}
    }
    function service(id: string, orgId: string, resourceId: string): Offering {
        return {
            id, orgId, resourceId,
            name: 'Личная консультация',
            description: 'Встреча со специалистом',
            duration: 45, before: 0, after: 15, capacity: 1,
            depositUnits: 0, active: true, revision: 1
        }
    }
    return {
        accounts: Object.fromEntries(Object.entries(DEMO_NAMES).map(function demoAccount([account, name]) {
            return [account, {account, name, secret: hashSecret(account + '-pass')}]
        })),
        organizations: {
            northstar: {
                id: 'northstar',
                name: 'Northstar Studio',
                members: {owner: 'owner', staff: 'staff', customer: 'customer', customer2: 'customer'}
            },
            harbor: {id: 'harbor', name: 'Harbor Labs', members: {outsider: 'owner'}}
        },
        resources: {studio: resource('studio', 'northstar', 'staff', 'Europe/Berlin'), harbor: resource('harbor', 'harbor', 'outsider', 'Europe/Moscow')},
        services: {consultation: service('consultation', 'northstar', 'studio'), harbor: service('harbor', 'harbor', 'harbor')},
        bookings: {}, waitlist: {}, notices: {}, intents: {}, audit: []
    }
}
