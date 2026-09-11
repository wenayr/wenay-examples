import React from 'react'
import type {Field,Answers} from '../backend/model'

export function visibleFields(fields:Field[],answers:Answers) {
    const visiting=new Set<string>()
    function visible(field:Field):boolean {
        if(!field.whenField)return true
        if(visiting.has(field.id))return false
        visiting.add(field.id)
        const parent=fields.find(value=>value.id==field.whenField)
        const result=!!parent&&visible(parent)&&Object.hasOwn(answers,parent.id)&&String(answers[parent.id])==field.whenEquals
        visiting.delete(field.id)
        return result
    }
    return fields.filter(visible)
}
export function cleanAnswers(fields:Field[],answers:Answers):Answers{return Object.fromEntries(visibleFields(fields,answers).filter(field=>Object.hasOwn(answers,field.id)).map(field=>[field.id,answers[field.id]]))}
export function Questions({fields,answers,change,disabled=false}:{fields:Field[],answers:Answers,change:(value:Answers)=>void,disabled?:boolean}) {
    function set(id:string,value:string|number|boolean|undefined){const next={...answers};if(value===undefined)delete next[id];else next[id]=value;change(cleanAnswers(fields,next))}
    return <div className="questions">{visibleFields(fields,answers).map((field,index)=><label key={field.id}><span><small>{String(index+1).padStart(2,'0')}</small>{field.label}{field.required&&<em aria-label="Обязательный вопрос"> *</em>}</span>{field.kind=='boolean'?<select aria-label={field.label} value={Object.hasOwn(answers,field.id)?String(answers[field.id]):''} required={field.required} disabled={disabled} onChange={event=>set(field.id,event.target.value==''?undefined:event.target.value=='true')}><option value="">Выберите ответ</option><option value="true">Да</option><option value="false">Нет</option></select>:field.kind=='choice'?<select aria-label={field.label} value={String(answers[field.id]??'')} required={field.required} disabled={disabled} onChange={event=>set(field.id,event.target.value||undefined)}><option value="">Выберите вариант</option>{field.choices.map(choice=><option key={choice}>{choice}</option>)}</select>:field.kind=='longtext'?<textarea aria-label={field.label} value={String(answers[field.id]??'')} required={field.required} minLength={field.min} maxLength={field.max} disabled={disabled} rows={3} onChange={event=>set(field.id,event.target.value)}/>:<input aria-label={field.label} type={field.kind=='number'?'number':'text'} step={field.kind=='number'?'any':undefined} min={field.kind=='number'?field.min:undefined} max={field.kind=='number'?field.max:undefined} minLength={field.kind=='text'?field.min:undefined} maxLength={field.kind=='text'?field.max:undefined} value={answers[field.id]===undefined?'':String(answers[field.id])} required={field.required} disabled={disabled} onChange={event=>set(field.id,field.kind=='number'?(event.target.value==''?undefined:Number(event.target.value)):event.target.value)}/>}</label>)}</div>
}
