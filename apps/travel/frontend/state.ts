import {createStore} from 'wenay-common2/observe'
import {defaultSearch} from '../demo/catalog.ts'

export function createTravelSearch() {
  // One snapshot keeps the two date and budget bounds consistent on every render.
  return createStore({
    search: {...defaultSearch}, hotelId: '', offerId: '',
  })
}
