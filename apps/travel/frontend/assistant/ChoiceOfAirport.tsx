import {useState} from 'react'
import type {TravelChatReply} from '../../src/assistant-contract.ts'
import {AirportPicker} from '../flights/AirportPicker.tsx'
import {Icon} from '../Icons.tsx'

type AirportOptions = NonNullable<TravelChatReply['airportOptions']>
const headings = {origin: 'Аэропорт вылета', destination: 'Аэропорт прилёта'} as const satisfies Record<AirportOptions['side'], string>

export function ChoiceOfAirport({options, busy, onChoose}: {options: AirportOptions, busy: boolean, onChoose: (iata: string) => void}) {
    const [code, setCode] = useState('')
    return <fieldset className="assistant-options assistant-airports" disabled={busy}>
        <legend>{headings[options.side]}</legend>
        <AirportPicker label="Город, регион или код IATA" value={code} onChange={setCode} initialText={options.query} autoOpen
            onSelect={airport => onChoose(airport.iata)}/>
        {code && <button type="button" className="assistant-primary" onClick={() => onChoose(code)}>
            Подтвердить {code} <Icon name="arrow" size={15}/></button>}
    </fieldset>
}
