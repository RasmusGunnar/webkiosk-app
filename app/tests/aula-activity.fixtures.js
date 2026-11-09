// Synthetic school examples only; no private Aula messages.
export const ida='00000000-0000-4000-8000-000000000011'
export const carl='00000000-0000-4000-8000-000000000012'
export const schoolExamples=[
 ['REMINDER','Husk tuscher','2026-11-11'],
 ['REMINDER','Husk gymnastiktøj','2026-11-11'],
 ['HOMEWORK','Matematik side 42-45','2026-11-12'],
 ['DEADLINE','Aflevering','2026-11-13'],
 ['REMINDER','Tag madpakke med','2026-11-12'],
 ['TRIP','Tur til Louisiana','2026-11-12'],
 ['CALENDAR_EVENT','Skolearrangement','2026-11-13'],
 ['CALENDAR_EVENT','Forældremøde','2026-11-12'],
]
export const source={source_key:'a'.repeat(64),source_kind:'message',title:'3.C',text:'3.C skal huske tuscher onsdag',updated_at:'2026-11-09T12:00:00Z',person_ids:[ida,carl],date:null,time:null,end_date:null,end_time:null,location:'',explicit_scope:true}
export const finding=(overrides={})=>({actionability:'BRING',evidence:'3.C skal huske tuscher onsdag',source_key:source.source_key,source_kind:'message',person_id:ida,person_ids:[ida],type:'REMINDER',title:'Husk tuscher',date:'2026-11-11',time:null,end_date:null,end_time:null,location:'',confidence:'HIGH',reason:'Konkret besked til 3.C.',summary:'Husk tuscher til onsdag.',proposed_action:'CREATE_ACTIVITY',status:'new',...overrides})
