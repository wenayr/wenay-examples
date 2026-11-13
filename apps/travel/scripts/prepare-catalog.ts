import {catalogIndexPath, openCatalogStorage} from '../backend/catalog-storage.ts'
import {createPropertyPhotos} from '../backend/property-photos.ts'

const storage = openCatalogStorage({photos: createPropertyPhotos({lazy: true})})
try {
    console.log('Индекс каталога готов:', catalogIndexPath())
    console.log('Обновлено снимков источников:', storage.importedSources())
} finally {
    storage.close()
}
