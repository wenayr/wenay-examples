export function localEndpoint(value: string) {
    const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value)
    if (!match || Number(match[1]) > 65535) throw new Error('expected a loopback HTTP endpoint with a valid port')
    return Number(match[1])
}

export function publicOrigin(value: string) {
    let url: URL
    try {url = new URL(value)} catch {throw new Error('expected a canonical HTTPS origin without credentials, path, query or fragment')}
    const https = url.protocol == 'https:' && !!url.hostname && !url.hostname.includes('*') && !value.includes(',')
    const originOnly = !url.username && !url.password && url.origin == value
    if (!https || !originOnly) throw new Error('expected a canonical HTTPS origin without credentials, path, query or fragment')
    return url.origin
}
