import React, {useMemo, useEffect, useState, useRef} from 'react'
import {useOwnedClient, useClientStore} from 'wenay-react2/react'
import type {ServiceClient} from 'wenay-common2/service/client'
import type {SupportDefinition} from '../backend/runtime'
import type {Attachment} from '../backend/files-resource'
import {useReplayView} from '../shared/react/replay-view'
import {useServiceAction} from '../shared/react/service-action'

type AttachmentsProps = {
    resources: ServiceClient<SupportDefinition>['resources'],
    orgId: string,
    ticketId: string,
    disabled: boolean
}

export function Attachments({resources, orgId, ticketId, disabled}: AttachmentsProps) {
    const owned = useOwnedClient({
        key: resources,
        create: () => ({...resources.open('files'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const scope = useRef({remote, orgId, ticketId, mounted: true})
    scope.current = {remote, orgId, ticketId, mounted: true}
    useEffect(function lifetime() {return () => {scope.current.mounted = false}}, [])
    // Ответ мог прийти после смены обращения или соединения: тогда он уже не наш.
    function current() {
        if (!scope.current.mounted || scope.current.remote != remote) return false
        return scope.current.orgId == orgId && scope.current.ticketId == ticketId
    }
    const view = useReplayView<{files: Attachment[]}>(remote?.view ?? null, () => ({files: []}))
    const action = useServiceAction(remote)
    const [download, setDownload] = useState<{id: string, url: string, name: string} | null>(null)
    useEffect(function release() {return () => {if (download) URL.revokeObjectURL(download.url)}}, [download])
    useEffect(function clear() {setDownload(null)}, [ticketId, orgId, remote])
    const files = view.state?.files.filter(file => file.ticketId == ticketId && file.orgId == orgId) ?? []
    async function upload(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (!file) return
        await action.action(async function send() {
            if (file.size > 512 * 1024) throw new Error('Максимальный размер файла — 512 КиБ')
            const bytes = new Uint8Array(await file.arrayBuffer())
            if (!current()) return
            await remote!.control.upload({orgId, ticketId, name: file.name, bytes})
        })
    }
    async function prepare(id: string) {
        await action.action(async function fetchFile() {
            setDownload(null)
            const file = await remote!.control.download(id)
            if (!current()) return
            const blob = new Blob([new Uint8Array(file.bytes)], {type: 'application/octet-stream'})
            setDownload({id, name: file.name, url: URL.createObjectURL(blob)})
        })
    }
    return <section className="attachments">
        <details>
            <summary>Вложения · {files.length}</summary>
            <p className="muted">До 512 КиБ на файл. Доступны участникам обращения.</p>
            <label>Прикрепить файл
                <input
                    type="file"
                    disabled={disabled || !view.ready || action.busy}
                    onChange={event => void upload(event)}
                />
            </label>
            {files.map(file => (
                <div key={file.id}>
                    <button disabled={disabled || action.busy} onClick={() => void prepare(file.id)}>
                        {file.name} · {Math.ceil(file.size / 1024)} КиБ
                    </button>
                    {download?.id == file.id && (
                        <a href={download.url} download={download.name}>Сохранить файл</a>
                    )}
                </div>
            ))}
            {(action.error || view.error) && (
                <p role="alert">{action.error || 'Подключение к вложениям прервано'}</p>
            )}
        </details>
    </section>
}
