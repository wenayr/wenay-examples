import type {Request, Response, NextFunction} from 'express'

export function createFormsBrowserPolicy(deps: {ancestors?: string} = {}) {
    const listed = (deps.ancestors ?? '').split(',').map(value => value.trim())
    const ancestors = listed.filter(Boolean).map(value => {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol) || url.origin != value) throw new Error('FORM_FRAME_ANCESTORS допускает только точные HTTP(S) origins')
        return url.origin
    })
    return function browserPolicy(_request: Request, response: Response, next: NextFunction) {
        response.setHeader('Content-Security-Policy', "frame-ancestors 'self' " + ancestors.join(' '))
        response.setHeader('Referrer-Policy', 'no-referrer')
        next()
    }
}
