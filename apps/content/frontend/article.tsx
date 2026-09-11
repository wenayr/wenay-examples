import React,{useEffect,useState} from 'react'
import type {Block} from '../backend/model'
import type {PublishedPage} from '../backend/domain'
import {PrivateImage} from './media'
import {date,type Resources} from './contracts'

export function Article({title,blocks,orgId,resources}:{title:string,blocks:Block[],orgId:string,resources?:Resources}) {
    return <article className="article"><h1>{title}</h1>{blocks.map(block=>block.kind=='heading'?<h2 key={block.id}>{block.text}</h2>:block.kind=='quote'?<blockquote key={block.id}>{block.text}</blockquote>:block.kind=='button'?<p key={block.id}><a className="article-link" href={block.href} target="_blank" rel="noreferrer">{block.text} ↗</a></p>:block.kind=='image'?<figure key={block.id}>{resources?<PrivateImage resources={resources} orgId={orgId} id={block.assetId} alt={block.text}/>:<img src={'/api/content/public/'+encodeURIComponent(orgId)+'/images/'+encodeURIComponent(block.assetId)} alt={block.text}/>}<figcaption>{block.text}</figcaption></figure>:<p key={block.id}>{block.text}</p>)}</article>
}
export function PublicJournal({orgId,initialSlug='',revisionKey=''}:{orgId:string,initialSlug?:string,revisionKey?:string}) {
    const [slug,setSlug]=useState(initialSlug),[reload,setReload]=useState(0)
    const [list,setList]=useState<{key:string,items:{id:string,slug:string,title:string,version:number}[]}|null>(null)
    const [loaded,setLoaded]=useState<{key:string,page:PublishedPage}|null>(null),[error,setError]=useState('')
    const key=orgId+':'+slug+':'+revisionKey+':'+reload
    useEffect(()=>{const controller=new AbortController();setLoaded(null);setList(null);setError('');void (async()=>{const base='/api/content/public/'+encodeURIComponent(orgId);const response=await fetch(base+(slug?'/'+encodeURIComponent(slug):''),{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('Материал снят с публикации или временно недоступен');const data=await response.json();if(!controller.signal.aborted){if(slug)setLoaded({key,page:data});else setList({key,items:data.pages})}})().catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error))});return()=>controller.abort()},[key])
    return <div className="public-journal"><header><a href="#" onClick={event=>{event.preventDefault();setSlug('')}}>Folio<span>JOURNAL</span></a><span>Хорошие истории остаются с нами.</span><button onClick={()=>setReload(value=>value+1)}>Обновить</button></header>{error?<section className="empty"><h1>Эта история пока недоступна</h1><p role="alert">{error}</p><button onClick={()=>setSlug('')}>К другим историям</button></section>:slug?loaded?.key==key?<><p className="public-meta">РЕДАКЦИЯ · {date(loaded.page.publishedAt)} · ВЫПУСК {loaded.page.version}</p><Article title={loaded.page.title} blocks={loaded.page.blocks} orgId={orgId}/></>:<p className="empty">Открываем опубликованную историю…</p>:<section className="journal-index"><p className="eyebrow">ВЫПУСКИ РЕДАКЦИИ</p><h1>Есть что рассказать.</h1><p>Истории, заметки и мысли нашей команды.</p><div>{list?.key==key?list.items.length?list.items.map((page,index)=><button key={page.id} onClick={()=>setSlug(page.slug)}><span>{String(index+1).padStart(2,'0')}</span><h2>{page.title}</h2><small>Читать историю →</small></button>):<p>Новые истории скоро появятся здесь.</p>:<p>Проверяем свежие публикации…</p>}</div></section>}<footer>Folio Journal · Написано людьми, для людей.</footer></div>
}

