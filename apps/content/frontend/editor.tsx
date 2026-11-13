import React, {useState} from 'react'
import {useReorder} from 'wenay-react2/react'
import type {Page, Asset, Block} from '../backend/model'
import {Article} from './article'
import {EditAssistant} from './assistant'
import {blockKinds, newBlock, type Resources, type Commands, type Organization} from './contracts'

type EditorProps = {
    page: Page | null,
    org: Organization,
    resources: Resources,
    commands: Commands,
    assets: Asset[],
    account: string,
    created: (id: string) => void
}

export function PageEditor({page, org, resources, commands, assets, account, created}: EditorProps) {
    // Автор ведёт только свои материалы, редактор и владелец — любые.
    const own = org.role == 'author' && (!page || page.author == account)
    const editable = ['owner', 'editor'].includes(org.role) || own

    return <>
        <DraftEditor
            key={page?.id + ':' + page?.revision}
            page={page}
            org={org}
            resources={resources}
            commands={commands}
            assets={assets}
            editable={editable}
            created={created}
        />
        {page && editable && <EditAssistant resources={resources} commands={commands} page={page}/>}
    </>
}

type DraftProps = {
    page: Page | null,
    org: Organization,
    resources: Resources,
    commands: Commands,
    assets: Asset[],
    editable: boolean,
    created: (id: string) => void
}

function blockLabel(kind: Block['kind']) {
    if (kind == 'image') return 'Описание для читателя'
    return kind == 'button' ? 'Текст кнопки' : 'Содержимое'
}

function DraftEditor({page, org, resources, commands, assets, editable, created}: DraftProps) {
    const [title, setTitle] = useState(page?.draft.title ?? 'Новая история')
    const [slug, setSlug] = useState(page?.draft.slug ?? 'new-story')
    const initialBlocks = page?.draft.blocks ?? [newBlock('heading'), newBlock('text')]
    const [blocks, setBlocks] = useState<Block[]>(initialBlocks)
    const [selected, setSelected] = useState(page?.draft.blocks[0]?.id ?? '')

    const current = blocks.find(block => block.id == selected) ?? blocks[0]
    const reorder = useReorder({
        order: blocks.map(block => block.id),
        preview: 'measure',
        canDrag: () => editable && !commands.busy,
        commit: order => setBlocks(previous => order.map(id => previous.find(block => block.id == id)!))
    })
    const images = assets.filter(asset => asset.orgId == org.id)

    function change(patch: Partial<Block>) {
        setBlocks(previous => previous.map(function patched(block) {
            return block.id == current.id ? {...block, ...patch} : block
        }))
    }
    async function save(event: React.FormEvent) {
        event.preventDefault()
        try {
            const result = await commands.execute('pageSave', {
                orgId: org.id,
                id: page?.id ?? '',
                revision: page?.revision ?? 0,
                title,
                slug,
                blocks
            })
            if (result && 'id' in result) created(result.id)
        } catch {}
    }
    function addBlock(kind: Block['kind']) {
        const block = newBlock(kind)
        setBlocks([...blocks, block])
        setSelected(block.id)
    }
    // Выбор картинки подставляет её описание, если у блока ещё нет своего.
    function chooseAsset(id: string) {
        const asset = images.find(item => item.id == id)
        change({assetId: id, ...(asset?.alt ? {text: asset.alt} : {})})
    }

    const structure = <div className="block-heading">
        <h2>Структура</h2>
        <label>
            <span className="sr-only">Добавить блок</span>
            <select
                aria-label="Добавить блок"
                value=""
                disabled={blocks.length >= 30}
                onChange={event => addBlock(event.target.value as Block['kind'])}
            >
                <option value="">+ Добавить блок</option>
                {Object.entries(blockKinds).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                ))}
            </select>
        </label>
    </div>

    const list = <div ref={reorder.listRef} className="block-list">
        {blocks.map(function row(block, index) {
            const item = reorder.item(block.id)
            return <div
                className={'block-row ' + (block.id == current.id ? 'selected' : '')}
                key={block.id}
                style={item.style}
            >
                <button {...item.handleProps} className="grip" aria-label={'Переместить блок ' + (index + 1)}>
                    ⠿
                </button>
                <button type="button" className="block-choice" onClick={() => setSelected(block.id)}>
                    <small>{blockKinds[block.kind]}</small>
                    <strong>{block.text.slice(0, 65)}</strong>
                </button>
                <button
                    type="button"
                    aria-label={'Удалить блок ' + (index + 1)}
                    disabled={blocks.length == 1}
                    onClick={() => setBlocks(blocks.filter(value => value.id != block.id))}
                >
                    ×
                </button>
            </div>
        })}
    </div>

    const settings = <section className="block-settings">
        <h3>{blockKinds[current.kind]}</h3>
        <label>{blockLabel(current.kind)}
            <textarea
                value={current.text}
                rows={current.kind == 'text' ? 6 : 3}
                onChange={event => change({text: event.target.value})}
                required
                maxLength={['text', 'quote'].includes(current.kind) ? 4000 : 500}
            />
        </label>
        {current.kind == 'image' && <label>Изображение из медиатеки
            <select
                value={current.assetId}
                onChange={event => chooseAsset(event.target.value)}
                required
            >
                <option value="">Выберите изображение</option>
                {images.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
        </label>}
        {current.kind == 'button' && <label>Ссылка HTTPS
            <input
                type="url"
                value={current.href}
                onChange={event => change({href: event.target.value})}
                required
            />
        </label>}
    </section>

    return <div className="draft-layout">
        <form className="draft-tools" onSubmit={save}>
            <div className="draft-label">
                <span className="eyebrow">{editable ? 'РАБОЧИЙ ЧЕРНОВИК' : 'ПРОСМОТР ЧЕРНОВИКА'}</span>
                {page && <small>Редакция {page.draftRevision}</small>}
            </div>
            <fieldset disabled={!editable || commands.busy}>
                <label>Название материала
                    <input
                        className="title-input"
                        value={title}
                        onChange={event => setTitle(event.target.value)}
                        required
                        maxLength={160}
                    />
                </label>
                <label>Адрес страницы
                    <input
                        value={slug}
                        onChange={event => setSlug(event.target.value)}
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        required
                        maxLength={80}
                    />
                    <small>Латинские буквы и дефисы: например, first-story.</small>
                </label>
                {structure}
                <p className="reorder-help">
                    Ручка для переноса. Клавиатура: пробел, стрелки, Enter. Escape отменяет.
                </p>
                {list}
                {settings}
                {editable && <button className="primary">Сохранить черновик</button>}
            </fieldset>
            {page && editable && <button
                className="review-submit"
                disabled={commands.busy}
                onClick={() => void commands.run('reviewSubmit', {
                    orgId: org.id,
                    id: page.id,
                    revision: page.revision
                })}
                type="button"
            >
                Отправить сохранённую версию на проверку →
            </button>}
            <small>
                Сохранение не меняет опубликованную страницу.
                Отправка на проверку создаёт отдельный снимок.
            </small>
        </form>
        <section className="draft-preview">
            <div className="preview-title">ПРЕДПРОСМОТР <span>Только для редакции</span></div>
            <div className="preview-paper">
                <Article title={title} blocks={blocks} orgId={org.id} resources={resources}/>
            </div>
        </section>
    </div>
}
