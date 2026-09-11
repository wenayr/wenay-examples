import {runNodeProcess} from 'wenay-common2/service/host'
import {organizerDefinition} from './service'

runNodeProcess({definition:organizerDefinition}).catch(function failed(error) {console.error(error);process.exitCode=1})
