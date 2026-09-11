import path from 'node:path'
import {startLxdAgent} from './lxd-agent'
import {installServiceSignals} from 'wenay-common2/service/host'

async function main() {
    const url = process.env.HOSTING_URL
    const account = process.env.HOSTING_AGENT_ACCOUNT
    const password = process.env.HOSTING_AGENT_PASSWORD
    const project = process.env.LXD_PROJECT
    const pool = process.env.LXD_POOL
    const network = process.env.LXD_NETWORK
    const credentials = url && account && password
    const placement = project && pool && network
    if (!credentials || !placement) {
        throw new Error('HOSTING_URL, HOSTING_AGENT_ACCOUNT/PASSWORD and LXD_PROJECT/POOL/NETWORK are required')
    }
    const agent = await startLxdAgent({url, account, password, project, pool, network,
        socketPath: process.env.LXD_SOCKET ?? '/var/snap/lxd/common/lxd/unix.socket',
        directory: process.env.HOSTING_AGENT_DATA ?? path.resolve('data/lxd-agent'),
    })
    installServiceSignals({close: agent.close})
    console.log('LXD agent connected; guest preparation is not yet verified')
}

main().catch(function failed(error) {
    console.error(error.message)
    process.exitCode = 1
})
