export {createApprovalService as createApprovalRuntime} from './service'
import type {createApprovalService} from './service'
export type ApprovalDefinition = ReturnType<typeof createApprovalService>['definition']
