import {useEffect, useState} from 'react'

export function usePageVisible() {
    const [visible, setVisible] = useState(() => document.visibilityState != 'hidden')
    useEffect(() => {
        function changed() { setVisible(document.visibilityState != 'hidden') }
        document.addEventListener('visibilitychange', changed)
        return () => document.removeEventListener('visibilitychange', changed)
    }, [])
    return visible
}
