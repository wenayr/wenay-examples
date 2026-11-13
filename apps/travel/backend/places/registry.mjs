// Bounded queries keep provider loads independent of map drags and arbitrary user input.
export const placeSources = [
    {id: 'osm', name: 'OpenStreetMap', url: 'https://www.openstreetmap.org', license: 'ODbL 1.0', licenseUrl: 'https://www.openstreetmap.org/copyright'},
    {id: 'wikidata', name: 'Wikidata', url: 'https://www.wikidata.org', license: 'CC0 1.0', licenseUrl: 'https://www.wikidata.org/wiki/Wikidata:Licensing'},
    {
        id: 'failte', name: 'Fáilte Ireland', url: 'https://data.gov.ie/dataset/national-quality-assurance-framework-register-of-accommodation',
        license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    },
]

function destination(id, name, country, latitude, longitude, bbox) {
    const sourceIds = ['osm', 'wikidata']
    if (country == 'Ирландия') sourceIds.push('failte')
    return {id, name, country, latitude, longitude, bbox, sourceIds}
}

export const placeDestinations = [
    destination('hurghada', 'Хургада', 'Египет', 27.184, 33.828, [33.72, 27.03, 33.97, 27.35]),
    destination('phuket', 'Пхукет', 'Таиланд', 7.899, 98.317, [98.24, 7.70, 98.48, 8.15]),
    destination('paphos', 'Пафос', 'Кипр', 34.775, 32.420, [32.35, 34.73, 32.50, 34.84]),
    destination('antalya', 'Анталья', 'Турция', 36.880, 30.704, [30.53, 36.80, 30.99, 36.97]),
    destination('sharm', 'Шарм-эль-Шейх', 'Египет', 27.919, 34.327, [34.25, 27.79, 34.46, 28.07]),
    destination('rhodes', 'Родос', 'Греция', 36.440, 28.222, [28.09, 36.31, 28.25, 36.48]),
    destination('mallorca', 'Пальма-де-Майорка', 'Испания', 39.570, 2.651, [2.56, 39.49, 2.77, 39.62]),
    destination('malaga', 'Малага', 'Испания', 36.719, -4.421, [-4.54, 36.65, -4.32, 36.79]),
    destination('tenerife', 'Коста-Адехе', 'Испания', 28.089, -16.734, [-16.81, 28.02, -16.63, 28.15]),
    destination('nice', 'Ницца', 'Франция', 43.697, 7.266, [7.18, 43.65, 7.32, 43.74]),
    destination('dubai', 'Дубай', 'ОАЭ', 25.148, 55.227, [55.10, 25.03, 55.36, 25.30]),
    destination('bali', 'Юг Бали', 'Индонезия', -8.711, 115.179, [115.08, -8.83, 115.26, -8.61]),
    destination('tallinn', 'Таллин', 'Эстония', 59.437, 24.753, [24.58, 59.37, 24.91, 59.49]),
    destination('dublin', 'Дублин', 'Ирландия', 53.350, -6.260, [-6.43, 53.25, -6.10, 53.43]),
    destination('cork', 'Корк', 'Ирландия', 51.898, -8.475, [-8.60, 51.83, -8.36, 51.96]),
    destination('galway', 'Голуэй', 'Ирландия', 53.270, -9.056, [-9.14, 53.23, -8.95, 53.34]),
]
