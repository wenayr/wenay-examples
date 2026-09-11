import type express from 'express'
import {createHash} from 'node:crypto'
import {createBlobHttpRouter, createLocalBlobStorage, type BlobAccess} from 'wenay-common2/server/blob'
import {UPLOADED_PHOTO} from '../shared/dish'

const MAX_BYTES = 2*1024*1024

// Photo formats, public visibility and stable legacy identifiers are product policy.
export function createDishMedia(deps: {directory: string, authorize: (token: string) => void}) {
    function format(bytes: Buffer) {
        if (bytes.length>12 && bytes[0]==255 && bytes[1]==216 && bytes[2]==255 && bytes.at(-2)==255 && bytes.at(-1)==217) return 'jpg'
        if (bytes.length>24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png'
        if (bytes.length>20 && bytes.toString('ascii',0,4)=='RIFF' && bytes.toString('ascii',8,12)=='WEBP') return 'webp'
        throw new Error('Нужна фотография JPEG, PNG или WebP')
    }
    const storage = createLocalBlobStorage({
        directory: deps.directory, maxBytes: MAX_BYTES,
        authorize({context, operation, id}: BlobAccess<string>) {
            if (operation != 'read') deps.authorize(context)
            if (id && !UPLOADED_PHOTO.test(id)) throw new Error('Неизвестная фотография')
        },
        validate(bytes) {format(bytes)},
        identify(bytes) {return createHash('sha256').update(bytes).digest('hex')+'.'+format(bytes)},
    })
    function mount(app: express.Express) {
        app.use('/api/media/photos', createBlobHttpRouter({
            storage,
            context(request) {return (request.get('authorization') ?? '').replace(/^Bearer\s+/i, '')},
            contentType(id) {return id.endsWith('.jpg') ? 'image/jpeg' : id.endsWith('.png') ? 'image/png' : 'image/webp'},
            cacheControl: 'public, max-age=31536000, immutable',
        }))
    }
    return {control: {upload: storage.control.upload}, mount}
}
export type DishMedia = ReturnType<typeof createDishMedia>
