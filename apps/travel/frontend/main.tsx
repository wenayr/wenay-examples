import {createRoot} from 'react-dom/client'
import {App} from './App.tsx'
import {createTravelSearch} from './state.ts'
import './style.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<App store={createTravelSearch()} />)
