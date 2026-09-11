import {createHash} from 'node:crypto'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {ROLES, type MonitoringState, type Monitor, type Observation} from './model'

type Ctx = ServiceCommandCtx<MonitoringState>
export function organizationAccess(state: MonitoringState, account: string, orgId: string, roles: readonly string[] = ROLES) {
    const org = Object.hasOwn(state.organizations, orgId) ? state.organizations[orgId] : undefined
    const role = org && Object.hasOwn(org.members, account) ? org.members[account] : undefined
    if (!org || !role || !roles.includes(role)) throw new Error('Нет доступа к организации')
    return {org, role}
}
export function monitoringRoles(state: MonitoringState, account: string) {return ['account', ...new Set(Object.values(state.organizations).flatMap(org => Object.hasOwn(org.members, account) ? [org.members[account]] : []))]}
function monitorAccess(ctx: Ctx, orgId: string, id: string, roles: readonly string[] = ROLES) {
    organizationAccess(ctx.state, ctx.account, orgId, roles)
    const monitor = Object.hasOwn(ctx.state.monitors, id) ? ctx.state.monitors[id] : undefined
    if (!monitor || monitor.orgId != orgId) throw new Error('Проверка недоступна')
    return monitor
}
function idOf(...parts: string[]) {return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)}
function text(value: string, max: number) {if (!value.trim() || value.length > max) throw new Error('Текст от 1 до ' + max + ' символов'); return value.trim()}
function integer(value: number, min: number, max: number) {if (!Number.isInteger(value) || value < min || value > max) throw new Error('Число от ' + min + ' до ' + max); return value}
function audit(ctx: Ctx, orgId: string, action: string, target: string, now: number) {
    ctx.state.audit.push({id: idOf(ctx.account, ctx.requestId, action), orgId, account: ctx.account, action, target, at: now})
    if (ctx.state.audit.length > 2000) ctx.state.audit.splice(0, ctx.state.audit.length - 2000)
}
function notice(ctx: Ctx, monitor: Monitor, incidentId: string, title: string, at: number) {
    for (const [account, role] of Object.entries(ctx.state.organizations[monitor.orgId].members)) {
        if (!['owner', 'oncall'].includes(role) || ctx.state.quiet[monitor.orgId + ':' + account]) continue
        const id = idOf(incidentId, title, account)
        if (!ctx.state.notices.some(item => item.id == id)) ctx.state.notices.push({id, orgId: monitor.orgId, account, incidentId, title, at, read: false})
    }
    if (ctx.state.notices.length > 2000) ctx.state.notices.splice(0, ctx.state.notices.length - 2000)
}
function observe(monitor: Monitor, observation: Observation) {
    monitor.history.push(observation)
    if (monitor.history.length > 300) monitor.history.splice(0, monitor.history.length - 300)
    monitor.lastAt = observation.at
}
export function monitoringWorkspace(state: MonitoringState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const organizations = Object.values(state.organizations).flatMap(org => {
        const role = org.members[account]
        return role && ROLES.includes(role as typeof ROLES[number]) ? [{id: org.id, name: org.name, revision: org.revision, role}] : []
    })
    const permitted = new Set(organizations.map(org => org.id))
    const staff = new Set(organizations.filter(org => org.role != 'observer').map(org => org.id))
    return {account, organizations, presets: staff.size ? state.presets.map(item => ({...item})) : [],
        people: Object.values(state.organizations).filter(org => staff.has(org.id)).flatMap(org => Object.entries(org.members).map(([id, role]) => ({orgId: org.id, account: id, role, name: state.accounts[id]?.name ?? id}))),
        monitors: Object.values(state.monitors).filter(item => permitted.has(item.orgId) && (staff.has(item.orgId) || item.public)).map(item => ({...item, lastWorker: staff.has(item.orgId) ? item.lastWorker : '', claim: staff.has(item.orgId) && item.claim ? {...item.claim} : null, presetId: staff.has(item.orgId) ? item.presetId : '', preferred: staff.has(item.orgId) ? item.preferred : '', history: item.history.map(point => ({...point, detail: staff.has(item.orgId) ? point.detail : ''}))})),
        incidents: Object.values(state.incidents).filter(item => permitted.has(item.orgId) && (staff.has(item.orgId) || state.monitors[item.monitorId]?.public)).map(item => ({...item, notes: staff.has(item.orgId) ? item.notes.map(note => ({...note})) : [], acknowledgedBy: staff.has(item.orgId) ? item.acknowledgedBy : ''})),
        notices: state.notices.filter(item => item.account == account && staff.has(item.orgId)).map(item => ({...item})),
        quiet: organizations.map(org => ({orgId: org.id, enabled: !!state.quiet[org.id + ':' + account]})),
        audit: state.audit.filter(item => staff.has(item.orgId)).map(item => ({...item}))}
}
export type MonitoringWorkspace = ReturnType<typeof monitoringWorkspace>
export function publicStatus(state: MonitoringState) {
    return {services: Object.values(state.monitors).filter(item => item.public).map(item => ({id: item.id, name: item.name, paused: item.paused, status: item.status, lastAt: item.lastAt, intervalMs: item.intervalMs,
        history: item.history.map(point => ({at: point.at, outcome: point.outcome, latencyMs: point.latencyMs}))})),
        incidents: Object.values(state.incidents).filter(item => state.monitors[item.monitorId]?.public).map(item => ({id: item.id, monitorId: item.monitorId, title: item.title, status: item.status, openedAt: item.openedAt, closedAt: item.closedAt}))}
}
export function createMonitoringDomain(deps: {now?: () => number, minIntervalMs?: number, takeoverMs?: number,
    incidentOpened?: (ctx: Ctx, monitor: Monitor, incidentId: string) => void} = {}) {
    const now = deps.now ?? Date.now, minInterval = deps.minIntervalMs ?? 15000, takeover = deps.takeoverMs ?? 5000
    return {commands: {
        configurePresets: schemaCommand({presets: {array: {object: {id: 'string', name: 'string'}}}}, {allow: ['system'], apply(ctx: Ctx, input) {
            if (ctx.account != 'system') throw new Error('Операторская настройка')
            if (input.presets.length > 100 || new Set(input.presets.map(item => item.id)).size != input.presets.length || input.presets.some(item => !/^[a-z0-9-]{1,60}$/.test(item.id) || !item.name.trim() || item.name.length > 120)) throw new Error('Некорректный набор целей')
            if (JSON.stringify(ctx.state.presets) == JSON.stringify(input.presets)) return {changed: false}
            ctx.state.presets = input.presets.map(item => ({...item}))
            for (const monitor of Object.values(ctx.state.monitors)) if (!input.presets.some(item => item.id == monitor.presetId)) {
                if (monitor.claim) observe(monitor, {attempt: monitor.claim.attempt, at: now(), outcome: 'unknown', latencyMs: 0, code: 0, detail: 'Оператор убрал цель проверки'})
                monitor.claim = null; monitor.paused = true; monitor.status = 'unknown'; monitor.revision++
            }
            return {changed: true}
        }}),
        monitorSave: schemaCommand({orgId: 'string', id: 'string', revision: 'number', name: 'string', presetId: 'string', preferred: 'string', public: 'boolean', paused: 'boolean', intervalMs: 'number', timeoutMs: 'number', downThreshold: 'number', upThreshold: 'number'}, {allow: ['owner'], apply(ctx: Ctx, input) {
            organizationAccess(ctx.state, ctx.account, input.orgId, ['owner'])
            const name = text(input.name, 120)
            if (!ctx.state.presets.some(item => item.id == input.presetId)) throw new Error('Выберите разрешённую оператором цель')
            if (ctx.state.organizations[input.orgId].members[input.preferred] != 'probe') throw new Error('Выберите обработчик этой организации')
            integer(input.intervalMs, minInterval, 86400000); integer(input.timeoutMs, 100, 10000); integer(input.downThreshold, 1, 10); integer(input.upThreshold, 1, 10)
            if (input.intervalMs <= input.timeoutMs) throw new Error('Интервал должен превышать тайм-аут')
            const old = input.id ? monitorAccess(ctx, input.orgId, input.id, ['owner']) : undefined
            if (old && old.revision != input.revision || !old && input.revision != 0) throw new Error('Проверка изменилась')
            if (!old && Object.keys(ctx.state.monitors).length >= 100) throw new Error('До 100 проверок')
            const id = old?.id ?? idOf(ctx.account, ctx.requestId)
            if (!old && ctx.state.monitors[id]) throw new Error('Идентификатор уже использован')
            if (old?.claim) observe(old, {attempt: old.claim.attempt, at: now(), outcome: 'unknown', latencyMs: 0, code: 0, detail: 'Настройки изменены во время проверки'})
            // History elements are plain copies before replacing their proxied parent.
            ctx.state.monitors[id] = {...input, id, name, revision: (old?.revision ?? 0) + 1, nextAt: now(), attempt: old?.attempt ?? 0, lastAt: old?.lastAt ?? 0,
                lastWorker: old?.lastWorker ?? '', status: old?.status ?? 'unknown', failures: 0, successes: 0, claim: null, history: old?.history.map(point => ({...point})) ?? [], incidentId: old?.incidentId ?? ''}
            audit(ctx, input.orgId, old ? 'Изменена проверка' : 'Создана проверка', id, now())
            return {id, revision: ctx.state.monitors[id].revision}
        }}),
        probeClaim: schemaCommand({orgId: 'string', id: 'string', revision: 'number'}, {allow: ['probe'], apply(ctx: Ctx, input) {
            const monitor = monitorAccess(ctx, input.orgId, input.id, ['probe']), at = now()
            if (monitor.paused || monitor.revision != input.revision || monitor.nextAt > at || monitor.claim && monitor.claim.until > at) return {claim: null}
            if (ctx.account != monitor.preferred && at < monitor.nextAt + takeover) return {claim: null}
            if (monitor.claim) {observe(monitor, {attempt: monitor.claim.attempt, at, outcome: 'unknown', latencyMs: 0, code: 0, detail: 'Исполнитель не подтвердил результат'}); monitor.failures = 0; monitor.successes = 0}
            const claim = {owner: ctx.account, attempt: ++monitor.attempt, until: at + monitor.timeoutMs + 2000, startedAt: at}
            monitor.claim = claim
            return {claim: {...claim}, presetId: monitor.presetId, timeoutMs: monitor.timeoutMs}
        }}),
        probeReport: schemaCommand({orgId: 'string', id: 'string', revision: 'number', attempt: 'number', outcome: {enum: ['up', 'down', 'unknown']}, latencyMs: 'number', code: 'number', detail: 'string'}, {allow: ['probe'], apply(ctx: Ctx, input) {
            const monitor = monitorAccess(ctx, input.orgId, input.id, ['probe']), at = now()
            const claim = monitor.claim
            if (!claim || claim.owner != ctx.account || claim.attempt != input.attempt || claim.until < at || monitor.revision != input.revision) return {accepted: false}
            integer(input.latencyMs, 0, 12000); integer(input.code, 0, 599)
            if (input.detail.length > 240) throw new Error('Слишком длинный результат')
            const willOpen = input.outcome == 'down' && monitor.failures + 1 >= monitor.downThreshold && !monitor.incidentId
            if (willOpen && Object.keys(ctx.state.incidents).length >= 1000) throw new Error('Архив инцидентов заполнен')
            const incidentId = idOf(monitor.id, String(claim.attempt))
            // Validate/create the derived task before the monitoring mutation can partially succeed.
            if (willOpen) deps.incidentOpened?.(ctx, monitor, incidentId)
            observe(monitor, {attempt: input.attempt, at, outcome: input.outcome, latencyMs: input.latencyMs, code: input.code, detail: input.detail})
            monitor.claim = null; monitor.nextAt = at + monitor.intervalMs
            monitor.lastWorker = ctx.account
            monitor.failures = input.outcome == 'down' ? monitor.failures + 1 : 0
            monitor.successes = input.outcome == 'up' ? monitor.successes + 1 : 0
            if (willOpen) {
                ctx.state.incidents[incidentId] = {id: incidentId, orgId: monitor.orgId, monitorId: monitor.id, title: monitor.name + ': проверка не проходит', openedAt: at, closedAt: 0, status: 'open', revision: 1, acknowledgedBy: '', notes: []}
                monitor.incidentId = incidentId
                notice(ctx, monitor, incidentId, 'Открыт инцидент', at)
                audit(ctx, monitor.orgId, 'Открыт инцидент', incidentId, at)
            }
            if (monitor.failures >= monitor.downThreshold) monitor.status = 'down'
            if (monitor.successes >= monitor.upThreshold) {
                monitor.status = 'up'
                const incident = ctx.state.incidents[monitor.incidentId]
                if (incident) {incident.status = 'resolved'; incident.closedAt = at; incident.revision++; notice(ctx, monitor, incident.id, 'Работа восстановлена', at); audit(ctx, monitor.orgId, 'Работа восстановлена', incident.id, at)}
                monitor.incidentId = ''
            }
            return {accepted: true}
        }}),
        incidentAcknowledge: schemaCommand({orgId: 'string', id: 'string', revision: 'number', body: 'string'}, {allow: ['owner', 'oncall'], apply(ctx: Ctx, input) {
            organizationAccess(ctx.state, ctx.account, input.orgId, ['owner', 'oncall'])
            const incident = Object.hasOwn(ctx.state.incidents, input.id) ? ctx.state.incidents[input.id] : undefined
            if (!incident || incident.orgId != input.orgId) throw new Error('Инцидент недоступен')
            if (incident.revision != input.revision || incident.status == 'resolved') throw new Error('Инцидент изменился или закрыт')
            const body = text(input.body, 2000)
            if (incident.notes.length >= 100) throw new Error('До 100 заметок')
            incident.status = 'acknowledged'; incident.acknowledgedBy = ctx.account; incident.revision++
            incident.notes.push({id: idOf(ctx.account, ctx.requestId), account: ctx.account, body, at: now()})
            return {revision: incident.revision}
        }}),
        notificationSettings: schemaCommand({orgId: 'string', quiet: 'boolean'}, {allow: ['owner', 'oncall'], apply(ctx: Ctx, input) {
            organizationAccess(ctx.state, ctx.account, input.orgId, ['owner', 'oncall']); ctx.state.quiet[input.orgId + ':' + ctx.account] = input.quiet
            return {quiet: input.quiet}
        }}),
        noticeRead: schemaCommand({orgId: 'string', id: 'string'}, {allow: ['owner', 'oncall'], apply(ctx: Ctx, input) {
            organizationAccess(ctx.state, ctx.account, input.orgId, ['owner', 'oncall'])
            const item = ctx.state.notices.find(item => item.id == input.id && item.orgId == input.orgId && item.account == ctx.account)
            if (!item) throw new Error('Уведомление недоступно')
            item.read = true; return {read: true}
        }}),
        memberRole: schemaCommand({orgId: 'string', revision: 'number', account: 'string', role: {enum: ['owner', 'oncall', 'observer', 'none']}}, {allow: ['owner'], apply(ctx: Ctx, input) {
            const {org} = organizationAccess(ctx.state, ctx.account, input.orgId, ['owner'])
            if (org.revision != input.revision) throw new Error('Команда изменилась')
            if (!Object.hasOwn(ctx.state.accounts, input.account) || org.members[input.account] == 'probe' || input.account.startsWith('probe-')) throw new Error('Учётная запись недоступна')
            if (org.members[input.account] == 'owner' && input.role != 'owner' && Object.values(org.members).filter(role => role == 'owner').length == 1) throw new Error('Нельзя снять последнего владельца')
            if (input.role == 'none') delete org.members[input.account]
            else org.members[input.account] = input.role
            org.revision++; return {revision: org.revision}
        }})
    }, views: {workspace: {allow: ROLES, project: monitoringWorkspace}, status: {allow: 'public' as const, project: publicStatus},
        assignments: {allow: ['probe'], project(state: MonitoringState, principal: tServicePrincipal | null) {
            return {targets: Object.values(state.monitors).filter(item => state.organizations[item.orgId]?.members[principal?.account ?? ''] == 'probe' && !item.paused).map(item => ({id: item.id, orgId: item.orgId, revision: item.revision, preferred: item.preferred, nextAt: item.nextAt, claimUntil: item.claim?.until ?? 0}))}
        }}}}
}
