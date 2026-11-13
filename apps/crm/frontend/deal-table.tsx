import React, {useMemo} from 'react'
import {AgGridTable, useAgGrid, useAgGridTheme} from 'wenay-react2/grid'
import type {ColDef} from 'ag-grid-community'
import type {CrmWorkspace} from '../backend/domain'
import type {tStage} from '../backend/model'
import {stages, money, date, type DealRow} from './contracts'

type TableProps = {
    rows: DealRow[],
    companies: CrmWorkspace['companies'],
    checked: string[],
    onChecked: (value: string[]) => void,
    select: boolean,
    onOpen: (id: string) => void
}

export function DealTable({rows, companies, checked, onChecked, select, onOpen}: TableProps) {
    const grid = useAgGrid<DealRow>({getId: row => row.id!, mode: 'overlay'})
    const theme = useAgGridTheme('light')

    const columns = useMemo<ColDef<DealRow>[]>(function definitions() {
        function selection({data}: {data: DealRow}) {
            function toggle(event: React.ChangeEvent<HTMLInputElement>) {
                const next = event.target.checked
                    ? [...checked, data.id]
                    : checked.filter(id => id != data.id)
                onChecked(next)
            }
            return <input
                type="checkbox"
                aria-label={'Выбрать ' + data.title}
                checked={checked.includes(data.id)}
                onChange={toggle}
            />
        }
        const selectColumn = {
            colId: 'select',
            headerName: '',
            width: 55,
            minWidth: 55,
            maxWidth: 55,
            sortable: false,
            filter: false,
            cellRenderer: selection
        }
        function title({data}: {data: DealRow}) {
            return <button className="table-link" onClick={() => onOpen(data.id)}>{data.title}</button>
        }
        return [
            ...(select ? [selectColumn] : []),
            {field: 'title', headerName: 'Сделка', minWidth: 250, flex: 2, cellRenderer: title},
            {
                field: 'companyId',
                headerName: 'Компания',
                minWidth: 160,
                flex: 1,
                valueFormatter: params => companies.find(item => item.id == params.value)?.name ?? '—'
            },
            {
                field: 'amount',
                headerName: 'Стоимость',
                width: 160,
                valueFormatter: params => money(params.value)
            },
            {
                field: 'stage',
                headerName: 'Этап',
                width: 150,
                valueFormatter: params => stages[params.value as tStage]
            },
            {field: 'assignee', headerName: 'Ответственный', width: 145},
            {
                field: 'updatedAt',
                headerName: 'Обновлено',
                width: 165,
                valueFormatter: params => date(params.value)
            }
        ]
    }, [companies, checked, onChecked, select, onOpen])

    const selection = {mode: 'singleRow' as const, checkboxes: false, enableClickSelection: false}

    return <div className="deal-grid">
        <AgGridTable<DealRow>
            controller={grid}
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            rowHeight={58}
            headerHeight={44}
            suppressCellFocus={false}
            rowSelection={selection}
        />
    </div>
}
