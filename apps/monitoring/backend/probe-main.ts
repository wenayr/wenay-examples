import {createProbeWorker} from './probe-worker'
import {probeTargets} from './http-probe'
const url = process.env.SERVICE_UPSTREAM
if (!url) throw new Error('SERVICE_UPSTREAM is required')
createProbeWorker({url, account: process.env.PROBE_ACCOUNT ?? 'probe-b', password: process.env.PROBE_PASSWORD ?? 'probe-b-pass', targets: probeTargets(process.env.MONITOR_TARGETS_JSON)}).then(function ready(worker) {
    process.send?.({type: 'ready', url})
    process.once('SIGINT', () => void worker.close())
    process.once('SIGTERM', () => void worker.close())
    process.once('message', function message(value) {if (value == 'shutdown') void worker.close().then(() => process.disconnect?.())})
    process.once('disconnect', () => void worker.close())
}).catch(function failed(error) {console.error(error); process.exitCode = 1})
