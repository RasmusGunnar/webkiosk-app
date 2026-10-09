import {t,dateFormatter} from '../i18n/index.js'
import {parseDate} from './calendar-dates.js'
// Keep IDs not offered by this editor (e.g. archived/not yet loaded people).
// Opening or editing a different field must never silently unassign them.
export function importedPersonSelection(selected,original,people){
 return [...new Set([...selected,...original.filter(id=>!people.some(person=>person.id===id))])]
}
export const importedScopes=[
 {value:'occurrence',label:(t("calendar.scope.single")),help:(t("imported_scopes.changes_only_this_occurrence")),hideHelp:(t("imported_scopes.removes_only_this_occurrence"))},
 {value:'future',label:(t("calendar.scope.future")),help:(t("imported_scopes.changes_this_and_all_following_occurrences")),hideHelp:(t("imported_scopes.removes_this_and_all_following_occurrences"))},
 {value:'series',label:(t("calendar.scope.series")),help:(t("imported_scopes.changes_the_entire_imported_series")),hideHelp:(t("imported_scopes.removes_the_entire_imported_series"))},
]
export function hiddenImportLabel(row){
 const scope=row.scope||(row.occurrence==='*'?'series':'occurrence')
 if(scope==='series')return (t("imported_scopes.whole_series_hidden"))
 const date=parseDate(row.effective_date||row.date)
 const label=date?dateFormatter({day:'numeric',month:'long',year:'numeric'}).format(date):''
 return scope==='future'?(t("imported_scopes.hidden_from")+" ")+(label||(t("imported_scopes.the_selected_occurrence"))):(t("imported_scopes.single_occurrence"))+(label?' · '+label:'')
}
