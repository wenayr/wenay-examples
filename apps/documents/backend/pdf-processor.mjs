import {readFile} from 'node:fs/promises'

async function main() {
    let error = 'pdf_invalid'
    let stop = async function idle() {}
    try {
        const data = new Uint8Array(await readFile(process.argv[2]))
        if (data.length > 512 * 1024) throw new Error('size')
        const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const loading = getDocument({data, verbosity: 0, stopAtErrors: true,
            disableFontFace: true, useSystemFonts: false, isOffscreenCanvasSupported: false, useWasm: false,
            maxImageSize: 0})
        stop = () => loading.destroy()
        const pdf = await loading.promise
        if (pdf.numPages > 10) {
            error = 'pdf_limit'
            throw new Error('pages')
        }
        const rows = []
        let size = 0
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber)
            const content = await page.getTextContent()
            let chunk = ''
            function saveChunk() {
                if (!chunk.trim()) return
                rows.push([String(pageNumber), chunk.trim()])
                chunk = ''
                if (rows.length > 200) {
                    error = 'pdf_limit'
                    throw new Error('rows')
                }
            }
            for (const item of content.items) {
                if (!('str' in item)) continue
                size += item.str.length
                if (size > 200000) {
                    error = 'pdf_limit'
                    throw new Error('text')
                }
                const text = item.str + (item.hasEOL ? '\n' : ' ')
                for (const character of text) {
                    if (chunk.length >= 990) saveChunk()
                    chunk += character
                }
            }
            saveChunk()
            page.cleanup()
        }
        if (!rows.length) {
            error = 'pdf_empty'
            throw new Error('no text')
        }
        // Родительский процесс читает строку как ASCII: не-ASCII отдаём \uXXXX.
        const payload = JSON.stringify({headers: ['Страница', 'Текст'], rows})
        const ascii = payload.replace(/[\u007f-\uffff]/g, function escaped(value) {
            return '\\u' + value.charCodeAt(0).toString(16).padStart(4, '0')
        })
        console.log('DOCUMENT_RESULT ' + ascii)
    } catch (problem) {
        if (problem instanceof Error && problem.name == 'PasswordException') error = 'pdf_password'
        console.log('DOCUMENT_RESULT ' + JSON.stringify({error}))
    } finally {await stop().catch(function alreadyClosed() {})}
    // The public process resource owns timeout, cancellation and process termination.
    setInterval(function waitForOwner() {}, 60000)
}

void main()
