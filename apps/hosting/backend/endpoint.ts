export function localEndpoint(value: string) {
    const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value)
    if (!match || Number(match[1]) > 65535) throw new Error('expected a loopback HTTP endpoint with a valid port')
    return Number(match[1])
}
