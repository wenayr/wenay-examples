import {runNodeProcess} from 'wenay-common2/service/host'
import {serviceDefinition} from './service'

runNodeProcess({definition: serviceDefinition}).then(function started(host) {
    process.send?.({type: 'ready', url: host.url})
    process.once('disconnect', function parentGone() {
        void host.close().catch(function failed(error) {console.error(error); process.exitCode = 1})
    })
}).catch(function failed(error) {console.error(error); process.exitCode = 1})
