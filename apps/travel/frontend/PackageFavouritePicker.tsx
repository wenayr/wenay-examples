import {packageFavouriteLevels, type tPackageFavouriteLevel} from './package-favourites.ts'

export function PackageFavouritePicker({level, onChange, disabled = false}: {
    level: tPackageFavouriteLevel
    onChange: (level: tPackageFavouriteLevel) => void
    disabled?: boolean
}) {
    return <fieldset className="package-favourites" disabled={disabled}>
        <legend>Моя отметка</legend>
        <div className="package-favourites__choices">{Object.entries(packageFavouriteLevels).map(([value, choice]) => {
            const next = Number(value) as tPackageFavouriteLevel
            return <button key={next} type="button" className="package-favourite-choice" data-level={next}
                aria-pressed={level == next} onClick={() => onChange(next)} style={{'--favourite-color': choice.color} as React.CSSProperties}>
                <span aria-hidden="true">{next ? '♥' : '○'}</span>{choice.label}
            </button>
        })}</div>
    </fieldset>
}
