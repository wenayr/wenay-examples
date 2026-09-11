import type {MenuItem} from '../backend/service'
import type {Inventory} from '../backend/inventory'

export const DEFAULT_PHOTOS = [
    {id:'default:margherita', title:'Маргарита', file:'margherita.png'},
    {id:'default:pepperoni', title:'Пепперони', file:'pepperoni.png'},
    {id:'default:vegetable', title:'Овощная', file:'vegetable.png'},
] as const
export const MAX_PHOTOS = 5
export const UPLOADED_PHOTO = /^[a-f0-9]{64}\.(jpg|png|webp)$/

export function dishDetails(item: Partial<DishDetails> & {id:string}) {
    return {
        description:item.description ?? '',
        composition:item.composition ?? '',
        portion:item.portion ?? '',
        photos:item.photos ?? [item.id=='diavola'?'default:pepperoni':'default:margherita'],
    }
}
export type DishDetails = {description:string, composition:string, portion:string, photos:string[]}

export function publicDish(item:MenuItem, ingredients:Inventory['ingredients']) {
    const details = dishDetails(item)
    return {id:item.id, title:item.title, price:item.price, ...details,
        composition:details.composition || item.recipe.map(part=>ingredients[part.ingredientId]?.title ?? part.ingredientId).join(', '),
    }
}
export type DishCard = ReturnType<typeof publicDish>

export function photoUrl(id:string, authority:string) {
    const preset = DEFAULT_PHOTOS.find(photo=>photo.id==id)
    return preset ? '/dish-photos/'+preset.file : UPLOADED_PHOTO.test(id) ? authority+'/api/media/photos/'+id : ''
}

export function validateDishDetails(input:Partial<DishDetails>) {
    for (const [key,max] of [['description',1200],['composition',600],['portion',100]] as const) {
        if ((input[key]?.length ?? 0)>max) throw new Error(`Поле ${key}: максимум ${max} символов`)
    }
    if (input.photos) {
        if (input.photos.length>MAX_PHOTOS || new Set(input.photos).size!=input.photos.length) throw new Error('До пяти фотографий без повторов')
        for (const id of input.photos) {
            if (!DEFAULT_PHOTOS.some(photo=>photo.id==id) && !UPLOADED_PHOTO.test(id)) throw new Error('Выберите готовую фотографию или загрузите файл')
        }
    }
}
