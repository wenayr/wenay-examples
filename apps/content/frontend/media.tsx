import React, {useEffect, useState} from 'react'
import type {Asset} from '../backend/model'
import {useServiceAction} from '../shared/react/service-action'
import {useContentResource, type Resources, type Commands, type Organization} from './contracts'

type ImageProps = {resources: Resources, orgId: string, id: string, alt: string}

export function PrivateImage({resources, orgId, id, alt}: ImageProps) {
    const remote = useContentResource(resources, 'files')
    const [loaded, setLoaded] = useState<{remote: typeof remote, key: string, url: string} | null>(null)
    const key = orgId + ':' + id

    useEffect(function readImage() {
        let active = true
        let url = ''
        setLoaded(null)
        if (!remote || !id) return
        void remote.control.download({orgId, id}).then(function received(file) {
            if (!active) return
            url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], {type: file.mime}))
            setLoaded({remote, key, url})
        }).catch(() => {})
        return () => {
            active = false
            if (url) URL.revokeObjectURL(url)
        }
    }, [remote, key])

    if (loaded && loaded.remote == remote && loaded.key == key) {
        return <img src={loaded.url} alt={alt}/>
    }
    return <div className="image-placeholder">
        {id ? 'Изображение недоступно или загружается' : 'Выберите изображение из медиатеки'}
    </div>
}

type LibraryProps = {resources: Resources, org: Organization, assets: Asset[], commands: Commands}

// Демонстрационная обложка рисуется в браузере: внешних запросов и платных вызовов нет.
async function coverImage() {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 500
    const context = canvas.getContext('2d')!
    context.fillStyle = '#e8d7c1'
    context.fillRect(0, 0, 800, 500)
    context.fillStyle = '#a74938'
    context.beginPath()
    context.arc(540, 210, 150, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#eadfcb'
    context.fillRect(450, 210, 280, 230)
    context.fillStyle = '#323d3c'
    context.font = 'bold 74px Georgia'
    context.fillText('Folio', 60, 155)
    context.font = '24px Georgia'
    context.fillText('A little room for a good story.', 65, 210)
    return new Promise<Blob>(function draw(resolve, reject) {
        canvas.toBlob(function ready(value) {
            if (value) resolve(value)
            else reject(new Error('Не удалось подготовить обложку'))
        }, 'image/png')
    })
}

export function MediaLibrary({resources, org, assets, commands}: LibraryProps) {
    const remote = useContentResource(resources, 'files')
    const action = useServiceAction(remote)
    const writable = ['owner', 'author', 'editor'].includes(org.role)
    const [notice, setNotice] = useState('')
    const mine = assets.filter(asset => asset.orgId == org.id)

    async function upload(file: File) {
        if (!remote) return
        await action.action(async function send() {
            if (file.size > 512 * 1024) throw new Error('Выберите изображение до 512 КиБ')
            const bytes = new Uint8Array(await file.arrayBuffer())
            const value = await remote.control.upload({orgId: org.id, name: file.name, bytes})
            setNotice('Добавлено: ' + value.name)
        })
    }
    async function sample() {
        const blob = await coverImage()
        await upload(new File([blob], 'folio-cover.png', {type: 'image/png'}))
    }
    function choose(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (file) void upload(file)
        event.target.value = ''
    }

    const controls = <div className="actions">
        <label className="upload-label">+ Загрузить изображение
            <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={!remote || action.busy}
                onChange={choose}
            />
        </label>
        <button
            disabled={!remote || action.busy}
            onClick={() => void sample().catch(reason => setNotice(String(reason)))}
        >
            Пример обложки
        </button>
    </div>

    function card(asset: Asset) {
        async function describe(event: React.FormEvent<HTMLFormElement>) {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            await commands.run('assetDescribe', {
                orgId: org.id,
                id: asset.id,
                revision: asset.revision,
                alt: String(data.get('alt'))
            })
        }
        return <article key={asset.id}>
            <PrivateImage
                resources={resources}
                orgId={org.id}
                id={asset.id}
                alt={asset.alt || asset.name}
            />
            <div>
                <h3>{asset.name}</h3>
                <small>{Math.ceil(asset.size / 1024)} КиБ · {asset.author}</small>
                <form key={asset.revision} onSubmit={describe}>
                    <label>Описание изображения
                        <input name="alt" defaultValue={asset.alt} disabled={!writable} maxLength={500}/>
                    </label>
                    {writable && <button disabled={commands.busy}>Сохранить описание</button>}
                </form>
                {writable && <button
                    className="danger"
                    disabled={action.busy}
                    onClick={() => void action.action(() => remote!.control.remove({orgId: org.id, id: asset.id}))}
                >
                    Удалить неиспользуемое
                </button>}
            </div>
        </article>
    }

    return <section className="media-page">
        <header className="page-heading">
            <div>
                <p className="eyebrow">ВИЗУАЛЬНЫЙ ЯЗЫК РЕДАКЦИИ</p>
                <h1>Медиатека</h1>
                <p>Свои изображения для ваших историй. PNG, JPEG, WebP до 512 КиБ.</p>
            </div>
            {writable && controls}
        </header>
        {(action.error || commands.error) && (
            <p className="error" role="alert">{action.error || commands.error}</p>
        )}
        {notice && <p className="notice" role="status">{notice}</p>}
        <div className="media-grid">{mine.map(card)}</div>
        {!mine.length && <p className="empty">Здесь появятся иллюстрации для материалов.</p>}
    </section>
}
