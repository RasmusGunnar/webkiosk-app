import {copenhagenDate,currentAulaFindings} from './aula-expiry.js'
// The same informational/actionable distinction used by the existing review UI.
export const aulaInformation=f=>f.type==='GENERAL_INFO'||f.proposed_action==='NO_ACTION'||f.confidence==='LOW'
export const actionableAulaFindings=(rows,today=copenhagenDate())=>currentAulaFindings(rows,today).filter(f=>!aulaInformation(f))
export function aulaPreviews(rows,today=copenhagenDate()){
 const date=f=>/^\d{4}-\d{2}-\d{2}$/.test(f.date||'')&&f.date>=today?f.date:'9999-12-31'
 const priority=f=>['DEADLINE','REMINDER'].includes(f.type)?0:1
 return actionableAulaFindings(rows,today).sort((a,b)=>date(a).localeCompare(date(b))||priority(a)-priority(b)).slice(0,2)
}
