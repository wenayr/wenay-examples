import path from 'node:path'
import {startDockerAgent} from './agent'
import {installServiceSignals} from 'wenay-common2/service/host'

async function main() {
    const url = process.env.HOSTING_URL
    const account = process.env.HOSTING_AGENT_ACCOUNT
    const password = process.env.HOSTING_AGENT_PASSWORD
    if (!url || !account || !password) throw new Error('HOSTING_URL, HOSTING_AGENT_ACCOUNT and HOSTING_AGENT_PASSWORD are required')
    const agent = await startDockerAgent({url, account, password,
        directory: process.env.HOSTING_AGENT_DATA ?? path.resolve('data/agent'),
        socketPath: process.env.DOCKER_SOCKET ?? (process.platform == 'win32' ? '\\\\.\\pipe\\dockerDesktopLinuxEngine' : '/var/run/docker.sock'),
    })
    installServiceSignals({close: agent.close})
    console.log('Docker agent connected')
}

main().catch(function failed(error) {
    console.error(error.message)
    process.exitCode = 1
})
