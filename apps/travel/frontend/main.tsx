import {createRoot} from 'react-dom/client'
import {App} from './App.tsx'
import {createPreferences} from './preferences.ts'
import {createTravelSearch} from './state.ts'
import './style.css'

async function start() {
    const element = document.getElementById('root')
    if (!element) return
    const preferences = createPreferences()
    const initial = await preferences.load()
    createRoot(element).render(<App store={createTravelSearch(initial, preferences)} />)
}

void start()
