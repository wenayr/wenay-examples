import React from 'react'
import type {NotificationView} from '../backend/notifications'
import type {CommandController} from './contracts'

export function Notifications({value, orgId, commands, busy}: {value: NotificationView, orgId: string, commands: CommandController, busy: boolean}) {
    const preferences = value.preferences.find(item => item.orgId == orgId)
    const notices = value.notices.filter(item => item.orgId == orgId)
    const unread = notices.filter(item => item.inApp && !item.read)
    if (!preferences) return <p>Нет доступа к уведомлениям организации.</p>
    return <section className="page-content"><div className="page-heading"><div><p className="eyebrow">НОВОСТИ ВАШЕЙ КОМАНДЫ</p><h1>Уведомления</h1><p>Ответы и изменения обращений. Настройки относятся только к вашему аккаунту.</p></div><button disabled={busy || !unread.length} onClick={() => void commands.run('notificationsRead', {orgId, ids: unread.map(item => item.id)})}>Прочитать все · {unread.length}</button></div>
        <div className="panel-form"><label><input type="checkbox" checked={preferences.inApp} disabled={busy} onChange={event => void commands.run('notificationPreferences', {orgId, inApp: event.target.checked, email: preferences.email})}/> Показывать новые события здесь</label><label><input type="checkbox" checked={preferences.email} disabled={busy} onChange={event => void commands.run('notificationPreferences', {orgId, inApp: preferences.inApp, email: event.target.checked})}/> Сохранять письма в локальную тестовую почту</label><p className="muted">Тестовая почта хранится в этом приложении. Письма никому не отправляются.</p></div>
        <h2>В приложении</h2>{notices.filter(item => item.inApp).map(item => <article className="panel-form" key={item.id}><strong>{item.read ? '' : '● '}{item.action}</strong><p>{item.subject}</p><small>{new Date(item.at).toLocaleString('ru-RU')}</small>{!item.read && <button disabled={busy} onClick={() => void commands.run('notificationsRead', {orgId, ids: [item.id]})}>Прочитано</button>}</article>)}{!notices.some(item => item.inApp) && <p className="empty">Новых событий пока нет.</p>}
        <h2>Тестовая почта</h2>{notices.filter(item => item.email).map(item => <article className="panel-form" key={item.id}><strong>{item.subject}</strong><p>{item.action}</p><small>Сохранено локально · {new Date(item.at).toLocaleString('ru-RU')}</small></article>)}{!notices.some(item => item.email) && <p className="empty">После включения сюда попадут новые события.</p>}
    </section>
}
