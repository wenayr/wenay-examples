import express, {type Express} from 'express'
import {createServiceRest, type ServiceLeader} from 'wenay-common2/service/server'
import type {ChatDefinition} from './service'

// Обход common2: SERVICE-COMMAND-RECEIPT-ACL — native REST receipts skip current domain roles; expose only credential login.
export function mountChatLogin(deps: {app: Express, leader: ServiceLeader<ChatDefinition>, definition: ChatDefinition}) {
    const login = express()
    createServiceRest({...deps, app: login, pages: {docs: false, panel: false}})
    deps.app.post('/api/chat/login', login)
}
