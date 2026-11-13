/// <reference types="vite/client" />
import React, {Profiler, useEffect, useRef} from 'react'

// Opt-in development measurement; production builds do not mount this wrapper.
export function RenderMetrics({children}: {children: React.ReactNode}) {
    const sample = useRef({commits: 0, milliseconds: 0, maxMilliseconds: 0})
    useEffect(function measure() {
        const timer = setInterval(function report() {
            console.debug('board-render / 2s', JSON.stringify(sample.current))
            sample.current = {commits: 0, milliseconds: 0, maxMilliseconds: 0}
        }, 2000)
        return function stop() {clearInterval(timer)}
    }, [])
    return <Profiler id="organizer" onRender={function rendered(_id, _phase, duration) {
        sample.current.commits++
        sample.current.milliseconds += duration
        sample.current.maxMilliseconds = Math.max(sample.current.maxMilliseconds, duration)
    }}>{children}</Profiler>
}
