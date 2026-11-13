import React, {useEffect, useRef, useState} from 'react'
import {DEFAULT_PHOTOS, MAX_PHOTOS, photoUrl} from '../shared/dish'

// Decode and resize before upload; the server independently bounds and checks binary input.
async function preparePhoto(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Выберите JPEG, PNG или WebP')
    if (file.size>20*1024*1024) throw new Error('Исходная фотография должна быть меньше 20 МБ')
    const bitmap = await createImageBitmap(file)
    try {
        const scale = Math.min(1, 1200/Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width*scale))
        canvas.height = Math.max(1, Math.round(bitmap.height*scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Не удалось обработать фотографию')
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob>(function encode(resolve, reject) {
            canvas.toBlob(function encoded(value) {
                if (value) resolve(value)
                else reject(new Error('Не удалось подготовить фотографию'))
            }, 'image/webp', 0.85)
        })
        if (blob.size>2*1024*1024) throw new Error('Фотография слишком большая даже после сжатия')
        return blob
    } finally {bitmap.close()}
}

export function DishPhotos({photos, authority, token, disabled, onChange, onBusy}: {
    photos: string[],
    authority: string,
    token: string,
    disabled: boolean,
    onChange: (photos: string[]) => void,
    onBusy: (busy: boolean) => void
}) {
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState('')
    const current = useRef<AbortController | null>(null)
    useEffect(function lifetime() {return function stopUpload() {current.current?.abort()}}, [])
    const blocked = disabled || uploading
    async function upload(event:React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        if (!files.length) return
        if (files.length+photos.length>MAX_PHOTOS) {
            setError('Можно добавить до пяти фотографий')
            return
        }
        const controller = new AbortController()
        current.current = controller
        setUploading(true)
        onBusy(true)
        setError('')
        const next = [...photos]
        try {
            for (const file of files) {
                const blob = await preparePhoto(file)
                if (controller.signal.aborted) return
                const response = await fetch(authority+'/api/media/photos', {
                    method: 'POST',
                    headers: {authorization: 'Bearer '+token, 'content-type': blob.type},
                    body: blob,
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])
                })
                if (response.status==403) throw new Error('Нужны права управления блюдами. Проверьте, что вы вошли в нужное заведение')
                if (response.status==413) throw new Error('Размер фотографии: до 2 МБ')
                if (!response.ok) throw new Error('Не удалось сохранить фотографию. Попробуйте другой файл JPEG, PNG или WebP')
                const body = await response.json()
                if (!body.ok) throw new Error('Не удалось загрузить фотографию')
                if (!next.includes(body.value.id)) next.push(body.value.id)
                onChange([...next])
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                setError(error instanceof Error ? error.message : 'Не удалось прочитать фотографию')
            }
        } finally {
            if (!controller.signal.aborted) {
                setUploading(false)
                onBusy(false)
            }
            current.current = null
        }
    }
    return <div className="dish-photo-editor"><h3>Фотографии</h3><p>До пяти снимков. Первый — обложка блюда. Файлы JPEG, PNG и WebP автоматически уменьшаются перед загрузкой.</p>
        <div className="photo-editor-grid">
            {photos.map((id, index) => (
                <div key={id}>
                    <img src={photoUrl(id, authority)} alt={'Фото блюда ' + (index + 1)}/>
                    <div className="row">
                        <button
                            type="button"
                            disabled={blocked || index == 0}
                            onClick={() => onChange([id, ...photos.filter(value => value != id)])}
                        >
                            {index == 0 ? 'Обложка' : 'На обложку'}
                        </button>
                        <button
                            type="button"
                            disabled={blocked}
                            aria-label={'Удалить фото ' + (index + 1)}
                            onClick={() => onChange(photos.filter(value => value != id))}
                        >
                            Удалить
                        </button>
                    </div>
                </div>
            ))}
        </div>
        <label>Загрузить фотографии
            <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={blocked || photos.length >= MAX_PHOTOS}
                onChange={upload}
            />
        </label>
        <p>{uploading ? 'Загружаем фотографии…' : 'Или выберите готовый вариант:'}</p>
        <div className="photo-presets">
            {DEFAULT_PHOTOS.map(function preset(photo) {
                const full = photos.length >= MAX_PHOTOS || photos.includes(photo.id)
                return <button
                    type="button"
                    key={photo.id}
                    disabled={blocked || full}
                    onClick={() => onChange([...photos, photo.id])}
                >
                    <img src={photoUrl(photo.id, authority)} alt=""/>
                    <span>{photo.title}</span>
                </button>
            })}
        </div>
        <small>Готовые изображения созданы ИИ. Выбирайте снимки, соответствующие вашему блюду.</small>
        {error && <p role="alert">{error}</p>}
    </div>
}
