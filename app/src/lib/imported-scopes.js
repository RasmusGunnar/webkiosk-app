import {parseDate} from './calendar-dates.js'
// Keep IDs not offered by this editor (e.g. archived/not yet loaded people).
// Opening or editing a different field must never silently unassign them.
export function importedPersonSelection(selected,original,people){
 return [...new Set([...selected,...original.filter(id=>!people.some(person=>person.id===id))])]
}
export const importedScopes=[
 {value:'occurrence',label:'Kun denne',help:'Ændrer kun denne forekomst.',hideHelp:'Fjerner kun denne forekomst.'},
 {value:'future',label:'Denne og frem',help:'Ændrer denne og alle kommende forekomster.',hideHelp:'Fjerner denne og alle kommende forekomster.'},
 {value:'series',label:'Hele serien',help:'Ændrer hele den importerede serie.',hideHelp:'Fjerner hele den importerede serie.'},
]
export function hiddenImportLabel(row){
 const scope=row.scope||(row.occurrence==='*'?'series':'occurrence')
 if(scope==='series')return 'Hele serien skjult'
 const date=parseDate(row.effective_date||row.date)
 const label=date?new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'long',year:'numeric'}).format(date):''
 return scope==='future'?'Skjult fra '+(label||'den valgte forekomst'):'Enkelt forekomst'+(label?' · '+label:'')
}
