// A focus describes where to look, not a claim that a supplier has fares there.
// Entries without a fixed tourId resolve their exact tour through the public reference on first use.
export const packageRegionDefinitions = {
    hurghada: {countryId: '5732', regionId: '5734'},
    sharm: {countryId: '5732', regionId: '5735'},
    rhodes: {countryId: '7067498', regionId: '9003981'},
    antalya: {countryId: '1104', tourName: 'ANTALYA'},
} as const satisfies Record<string, {countryId: string, regionId?: string, tourName?: string}>

export interface TezRegion {countryId: string, regionId: string}
