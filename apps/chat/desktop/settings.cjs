const fs = require('node:fs')
const io = require('node:fs/promises')
const path = require('node:path')
const {randomUUID} = require('node:crypto')
const {configuredOrigin} = require('./origin.cjs')

function createEndpointSettings(deps) {
    const file = path.join(deps.directory, 'endpoint.json')
    function read() {
        let descriptor
        try {
            descriptor = fs.openSync(file, 'r')
            if (fs.fstatSync(descriptor).size > 8192) throw new Error('Settings too large')
            const bytes = Buffer.alloc(8193)
            const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0)
            if (length > 8192) throw new Error('Settings too large')
            const value = JSON.parse(bytes.subarray(0, length).toString('utf8'))
            if (value.version != 1 || Object.keys(value).sort().join(',') != 'origin,version') return null
            return configuredOrigin(value.origin)
        } catch {return null}
        finally {if (descriptor != undefined) fs.closeSync(descriptor)}
    }
    async function write(input) {
        const origin = configuredOrigin(input.origin)
        const temporary = path.join(deps.directory, 'endpoint-' + randomUUID() + '.tmp')
        try {
            await io.mkdir(deps.directory, {recursive: true})
            if (!input.actual()) throw new Error('Setup closed')
            await io.writeFile(temporary, JSON.stringify({version: 1, origin}), {flag: 'wx', mode: 0o600})
            if (!input.actual()) throw new Error('Setup closed')
            // No async gap between the final scope guard and atomic settings commit.
            fs.renameSync(temporary, file)
        } finally {await io.rm(temporary, {force: true})}
    }
    return {read, write}
}

module.exports = {createEndpointSettings}
