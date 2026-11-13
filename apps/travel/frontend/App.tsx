import {useEffect, useState} from 'react'
import type {createTravelSearch} from './state.ts'
import {DemoTours} from './DemoTours.tsx'
import {Directory} from './Directory.tsx'
import {PackageSearch} from './PackageSearch.tsx'
import {Icon} from './Icons.tsx'
import './directory.css'

function pageFromLocation() {
    const [page, destinationId] = window.location.hash.slice(1).split('/')
    if (page === 'packages') return {page, destinationId}
    return {page: page === 'demo' ? 'demo' : 'catalog'}
}

export function App({store}: {store: ReturnType<typeof createTravelSearch>}) {
    const [{page, destinationId}, setPage] = useState(pageFromLocation)
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
                <a href="#packages" aria-current={page == 'packages' ? 'page' : undefined}>Пакетные туры</a>
                <a href="#demo" aria-current={page == 'demo' ? 'page' : undefined}>Демо туров</a>
            </nav>
            <div className="mast-location"><span>Таллин, Эстония</span><span>EUR €</span></div>
        </div></header>
        {page == 'packages' && <PackageSearch destinationId={destinationId}/>}
        {page == 'catalog' && <Directory/>}
        {page == 'demo' && <DemoTours store={store}/>}
    </>
}
