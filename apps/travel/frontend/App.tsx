import {useEffect, useState} from 'react'
import type {createTravelSearch} from './state.ts'
import {DemoTours} from './DemoTours.tsx'
import {Directory} from './Directory.tsx'
import {Icon} from './Icons.tsx'
import './directory.css'

function pageFromLocation() {
    return window.location.hash == '#demo' ? 'demo' : 'catalog'
}

export function App({store}: {store: ReturnType<typeof createTravelSearch>}) {
    const [page, setPage] = useState(pageFromLocation)
    useEffect(() => {
        function navigate() {
            setPage(pageFromLocation())
        }
        window.addEventListener('hashchange', navigate)
        return () => window.removeEventListener('hashchange', navigate)
    }, [])
    return <>
        <header className="site-mast"><div className="mast-inner">
            <a className="wordmark" href="#catalog" aria-label="Wenay Travel, каталог отелей">
                <span className="brand-icon"><Icon name="compass" size={23}/></span>Wenay <em>Travel</em>
            </a>
            <nav aria-label="Разделы Wenay Travel" className="travel-pages">
                <a href="#catalog" aria-current={page == 'catalog' ? 'page' : undefined}>Отели</a>
                <a href="#demo" aria-current={page == 'demo' ? 'page' : undefined}>Демо туров</a>
            </nav>
            <div className="mast-location"><span>Таллин, Эстония</span><span>EUR €</span></div>
        </div></header>
        {page == 'catalog' ? <Directory/> : <DemoTours store={store}/>}
    </>
}
