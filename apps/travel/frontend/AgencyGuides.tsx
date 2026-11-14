import {Fragment, useEffect, useState, type ReactNode} from 'react'
import {safeHref} from './DirectoryCard.tsx'
import {travelHash, type TravelRoute} from './navigation.ts'
import './agency.css'

const guides = {
    agency: {title: 'Открыть агентство в Эстонии', load: () => import('../docs/AGENCY-ESTONIA.md?raw')},
    b2b: {title: 'Подключить отели и операторов', load: () => import('../docs/B2B-ONBOARDING.md?raw')},
    providers: {title: 'Настроить источники', load: () => import('../docs/PROVIDERS.md?raw')},
    travel: {title: 'Планировать поездку', load: () => import('../GUIDE.md?raw')},
} as const
type tGuide = keyof typeof guides

function documentLink(value: string) {
    value = value.replace(/^docs\//, '')
    const local = {
        'AGENCY-ESTONIA.md': 'agency', 'B2B-ONBOARDING.md': 'b2b', 'PROVIDERS.md': 'providers', '../GUIDE.md': 'travel',
    } as const
    if (Object.hasOwn(local, value)) return travelHash('guides', undefined, {guide: local[value as keyof typeof local]})
    if (value == '../README.md' || value == '../PARTNERS.md') {
        return 'https://github.com/wenayr/wenay-examples/blob/demo/travel-flexible-dates/apps/travel/' + value.slice(3)
    }
    return safeHref(value)
}

function inline(text: string): ReactNode {
    const parts = text.split(/(\[[^\]]+\]\([^\s)]+\)|https?:\/\/[^\s]+|\*\*[^*]+\*\*|`[^`]+`)/g)
    return parts.map((part, index) => {
        const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part)
        if (link) {
            const href = documentLink(link[2])
            return <a key={index} href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{link[1]}</a>
        }
        if (part.startsWith('https://') || part.startsWith('http://')) {
            return <a key={index} href={safeHref(part)} target="_blank" rel="noopener noreferrer">{part}</a>
        }
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
        return <Fragment key={index}>{part}</Fragment>
    })
}

function MarkdownBlock({text}: {text: string}) {
    const lines = text.split('\n')
    const heading = /^(#{1,4})\s+(.+)$/.exec(text)
    if (heading) {
        if (heading[1].length == 1) return null
        if (heading[1].length == 2) return <h2>{inline(heading[2])}</h2>
        if (heading[1].length == 3) return <h3>{inline(heading[2])}</h3>
        return <h4>{inline(heading[2])}</h4>
    }
    if (text.startsWith('```')) return <pre><code>{lines.slice(1, -1).join('\n')}</code></pre>
    if (lines.every(line => /^\s*[-*]\s+/.test(line))) {
        return <ul>{lines.map((line, index) => <li key={index}>{inline(line.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>
    }
    if (lines.every(line => /^\s*\d+\.\s+/.test(line))) {
        return <ol>{lines.map((line, index) => <li key={index}>{inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>)}</ol>
    }
    if (lines.length > 1 && /^\|?\s*:?-{3,}/.test(lines[1])) {
        const cells = (line: string) => line.replace(/^\||\|$/g, '').split('|').map(value => value.trim())
        return <div className="agency-table-scroll"><table><thead><tr>
            {cells(lines[0]).map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead>
            <tbody>{lines.slice(2).map((line, index) => <tr key={index}>
                {cells(line).map((cell, column) => <td key={column}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>
    }
    if (lines.every(line => line.startsWith('>'))) return <blockquote>{inline(lines.map(line => line.replace(/^>\s?/, '')).join(' '))}</blockquote>
    if (/^[-*_]{3,}$/.test(text)) return <hr/>
    return <p>{inline(text)}</p>
}

export function GuideReader({text}: {text: string}) {
    const blocks = text.trim().match(/```[\s\S]*?```|(?:[^\n]|\n(?!\n))+/g) ?? []
    return <article className="agency-article">{blocks.map((block, index) => <MarkdownBlock key={index} text={block.trim()}/>)}</article>
}

export function AgencyGuides({route}: {route: TravelRoute}) {
    const requested = route.query.get('guide')
    const selected = requested && Object.hasOwn(guides, requested) ? requested as tGuide : 'agency'
    const [content, setContent] = useState<{key: tGuide, text?: string, error?: string} | null>(null)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        let active = true
        async function load() {
            try {
                const result = await guides[selected].load()
                if (active) setContent({key: selected, text: result.default})
            } catch {
                if (active) setContent({key: selected, error: 'Не удалось открыть руководство.'})
            }
        }
        void load()
        return () => { active = false }
    }, [selected, attempt])
    const visible = content?.key == selected ? content : null
    return <main className="travel-home agency-home"><header className="agency-heading">
        <p>Практические руководства</p><h1>{guides[selected].title}</h1>
        <div><a href="#providers">Источники и подключение →</a><a href="#discover">Планировать поездку →</a></div>
    </header><div className="agency-layout"><nav className="agency-guide-nav" aria-label="Руководства">
        {Object.entries(guides).map(([id, guide]) => <a key={id} href={travelHash('guides', undefined, {guide: id})}
            aria-current={selected == id ? 'page' : undefined}>{guide.title}</a>)}
    </nav><div className="agency-guide-content">
        {!visible && <p role="status">Открываем руководство…</p>}
        {visible?.error && <p role="status">{visible.error} <button onClick={() => setAttempt(value => value + 1)}>Повторить</button></p>}
        {visible?.text && <GuideReader text={visible.text}/>}
    </div></div></main>
}
