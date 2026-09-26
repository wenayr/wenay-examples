import type {tClientCommands} from 'wenay-common2/service/client'
import type {tCommandRun} from '../shared/react/command-action'
import type {organizerDefinition} from './service'
import type {WorkPerson, WorkTask, WorkView} from './model'

export type ScheduleProps = {
    value: WorkView,
    allPeople: WorkPerson[],
    tasks: WorkTask[],
    busy: boolean,
    ready: boolean,
    generation: number,
    run: tCommandRun<tClientCommands<typeof organizerDefinition>>,
    edit: (task: WorkTask) => void
}

export type ScheduleSurfaceProps = ScheduleProps & {plan: (task: WorkTask) => void}

export type ScheduleDayProps = ScheduleSurfaceProps & {
    date: string,
    from: number,
    to: number,
    step: number,
    pixelsPerHour: number
}

export function canPlan(value: WorkView, task: WorkTask) {
    if (task.automatic || task.status == 'done') return false
    return value.manage || task.assignee == value.me || task.createdBy == value.me
}
