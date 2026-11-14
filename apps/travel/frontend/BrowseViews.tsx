import {useState} from 'react'
import {Icon} from './Icons.tsx'

const views = {list: 'Список', map: 'Карта'} as const
type View = keyof typeof views
export function useBrowseViews() {
    const [view, setView] = useState<View>('list')
    return {view, setView}
}

export function BrowseViews({view, setView}: ReturnType<typeof useBrowseViews>) {
    return <div className="browse-views" role="group" aria-label="Вид результатов">
        {(Object.keys(views) as View[]).map(key => <button type="button" key={key} aria-pressed={view === key}
            onClick={() => setView(key)}><Icon name={key === 'list' ? 'list' : 'map'} size={15}/>{views[key]}</button>)}
    </div>
}
