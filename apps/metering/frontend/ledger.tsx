import React, {useState} from 'react'
import {AgGridTable} from 'wenay-react2/grid'
import {themeQuartz, QuickFilterModule, type ColDef} from 'ag-grid-community'
import type {MeteringWorkspace} from '../backend/domain'
import {date, metrics, statuses} from './contracts'

type Event = MeteringWorkspace['events'][number]
const theme = themeQuartz.withParams({
    fontFamily: 'Inter, Segoe UI, sans-serif',
    fontSize: 12,
    headerFontSize: 11,
    headerBackgroundColor: '#f6f8fb',
    backgroundColor: '#ffffff',
    foregroundColor: '#34475f',
    borderColor: '#e5eaf0',
    rowBorder: {color: '#edf0f5'},
    accentColor: '#4b74d3',
    wrapperBorderRadius: 10
})

const metricName = (value: {value: string}) => metrics[value.value as keyof typeof metrics] ?? ''
const statusName = (value: {value: string}) => statuses[value.value as keyof typeof statuses] ?? ''
const columns: ColDef<Event>[] = [
    {field: 'eventId', headerName: 'ID события', minWidth: 180, flex: 1.2},
    {field: 'metric', headerName: 'Продукт', valueFormatter: metricName, minWidth: 115},
    {field: 'status', headerName: 'Состояние', valueFormatter: statusName, minWidth: 160},
    {field: 'units', headerName: 'Учтено, ед.', minWidth: 115, type: 'numericColumn'},
    {field: 'reservedUnits', headerName: 'Исходный резерв', minWidth: 150, type: 'numericColumn'},
    {field: 'reference', headerName: 'Основание', minWidth: 170, flex: 1},
    {field: 'updatedAt', headerName: 'Обновлено', valueFormatter: value => date(value.value), minWidth: 150, sort: 'desc'},
    {field: 'reason', headerName: 'Комментарий', minWidth: 190, flex: 1}
]
const modules = [QuickFilterModule]
const selection = {
    mode: 'multiRow' as const,
    checkboxes: false,
    headerCheckbox: false,
    enableClickSelection: false
}
const defaultColumn = {sortable: true, filter: true, resizable: true}

export default function Ledger({events}: {events: Event[]}) {
    const [query, setQuery] = useState('')
    return <section className="panel ledger">
        <div className="panel-heading">
            <div>
                <h2>Операции периода</h2>
                <p>Сортируйте и фильтруйте строки. Идентификатор события связывает повторные запросы.</p>
            </div>
            <label className="ledger-search">
                <span className="sr-only">Поиск операции</span>
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Поиск по журналу…"
                />
            </label>
        </div>
        <div className="ledger-grid">
            <AgGridTable<Event>
                rowData={events}
                modules={modules}
                rowSelection={selection}
                getRowId={params => params.data.id}
                columnDefs={columns}
                defaultColDef={defaultColumn}
                theme={theme}
                quickFilterText={query}
                rowHeight={45}
                headerHeight={42}
                animateRows={false}
                overlayNoRowsTemplate="<span>В этом периоде ещё нет операций</span>"
            />
        </div>
        <p className="footnote">
            Таблица использует AgGridTable из wenay-react2, строки поступают из ролевой проекции common2.
        </p>
    </section>
}

