// Канон: shared/react/deferred-panel.tsx; копии проверяет scripts/sync-check.mjs.
import {Component, Suspense, type ReactNode} from 'react'

type DeferredPanelProps = {loadingLabel: string, children: ReactNode, className?: string}

function reloadPage() {
    window.location.reload()
}

// React error boundaries require a class; this boundary owns no application resource.
export class DeferredPanel extends Component<DeferredPanelProps> {
    state = {failed: false}

    static getDerivedStateFromError() {
        return {failed: true}
    }

    render() {
        const {loadingLabel, children, className} = this.props
        if (this.state.failed) return <div className={className} role="alert">
            <p>Не удалось открыть раздел. Обновите страницу, чтобы повторить загрузку.</p>
            <button type="button" onClick={reloadPage}>Обновить страницу</button>
        </div>
        return <Suspense fallback={<div className={className} role="status" aria-live="polite">{loadingLabel}</div>}>
            {children}
        </Suspense>
    }
}
