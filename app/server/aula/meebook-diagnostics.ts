import {type ReadProvider,type RecordData,type Child,textOnly,localDateTime} from './provider.ts';
import {isoWeek} from './collection.ts';
import {resolvePlanDate} from './meebook-date.ts';

// Fixed structural counters only. Never return source bodies, IDs, URLs or names.
const fields=['type','pill','title','content','date','id','editUrl','deadline','dueDate','due_date','category','planning','status'];
const enumType=(value:unknown)=>typeof value==='string'&&/^[a-z_]{1,24}$/.test(value)?value:typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<100?'number_'+value:value==null?'missing':'other';
export function inspectMeeBook(rows:RecordData[],week:string){
 const counts:Record<string,number>={plans:rows.length,items:0,reference_matches:0};
 const inc=(key:string)=>{counts[key]=(counts[key]??0)+1;};
 for(const person of rows){
  if(person.exceptionMessage)inc('plan_exceptions');
  for(const day of person.weekPlan??[])for(const task of day.tasks??[]){
   counts.items++;const type=enumType(task.type);inc('type_'+type);
   for(const field of fields)if(task[field]!==undefined&&task[field]!==null)inc('type_'+type+'_field_'+field);
   if(typeof task.content==='string'&&task.content.trim())inc('type_'+type+'_has_content');
   if(day.date!=null){inc('type_'+type+'_has_day_date');
    const resolved=resolvePlanDate(day.date,week);if(resolved.date){inc('date_resolved_in_requested_week');inc('date_order_'+resolved.order);}else inc('date_unresolved');
    // Do not log the value: distinguish yearless display labels from real
    // timestamps. JS Date.parse silently assigns year 2001 to many short labels.
    if(typeof day.date==='string'){
     const value=day.date.trim();
     if(/^\d{1,2}\/\d{1,2}\/?$/.test(value))inc('date_shape_day_month_slash');
     else if(/^\d{1,2}\.\d{1,2}\.?$/.test(value))inc('date_shape_day_month_dot');
     else if(/^\d{1,2}-\d{1,2}$/.test(value))inc('date_shape_day_month_dash');
     else if(/^\d{1,2}$/.test(value))inc('date_shape_single_number');
     else if(/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(value))inc('date_shape_iso');
     else inc('date_shape_other');
     if(Number.isFinite(Date.parse(value))&&new Date(value).getUTCFullYear()===2001)inc('date_parse_default_year');
    }
    if(typeof day.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day.date)&&Number.isFinite(Date.parse(day.date))){inc('day_date_iso');if(isoWeek(new Date(day.date+'T12:00:00Z'))===week)inc('day_date_in_requested_week');}
    else if(typeof day.date==='string'&&Number.isFinite(Date.parse(day.date))){inc('day_date_timestamp');if(isoWeek(new Date(day.date))===week)inc('day_date_in_requested_week');if(/(Z|[+-]\d{2}:?\d{2})$/i.test(day.date))inc('day_date_has_zone');else inc('day_date_floating');if(/T00:00:00/.test(day.date))inc('day_date_midnight');}else inc('day_date_other');
   }
   // Only test the example explicitly supplied by the user; never output its contents.
   const title=textOnly((task.title??'')+' '+(task.content??'')).replace(/\u00ad/g,'').replace(/\s+/g,' ').toLocaleLowerCase('da');
   if(title.includes('aflevering af ugetræningsside')){inc('reference_matches');inc('reference_type_'+type);if(task.deadline||task.dueDate||task.due_date)inc('reference_has_deadline');if(day.date){inc('reference_has_day_date');const date=localDateTime(day.date).date,today=localDateTime(new Date().toISOString()).date;if(date&&today)inc(date<today?'reference_day_past':'reference_day_current_or_future');}}
  }
 }
 return counts;
}
export async function diagnoseMeeBook(provider:ReadProvider,report:(stage:string,counts:Record<string,number>)=>void,now=new Date()){
 const profiles=await provider.read('profiles.getProfilesByLogin'),ctx=await provider.read('profiles.getProfileContext',{portalrole:'guardian'});
 const raw=[...(profiles?.profiles??[]).filter((p:RecordData)=>!p.portalRole||p.portalRole==='guardian').flatMap((p:RecordData)=>p.children??[]),...(ctx.institutions??[]).flatMap((i:RecordData)=>i.children??[]),...(ctx.institutionProfile?.relations??[]).flatMap((r:RecordData)=>r.children??[]),...(ctx.institutionProfiles??[]).flatMap((p:RecordData)=>(p.relations??[]).flatMap((r:RecordData)=>r.children??[]))];
 const children=[...new Map<string,RecordData>(raw.map((c:RecordData)=>[String(c.id),c])).values()].map(c=>({id:String(c.id),userId:String(c.userId??''),institutionCode:String(c.institutionCode??'')})) as Child[];
 report('diagnostic.profiles.ok',{children:children.length});
 for(const [name,offset]of [['previous',-7],['current',0],['next',7]] as const){const week=isoWeek(new Date(now.getTime()+offset*864e5));const rows=await provider.meebook(ctx,children,week);report('diagnostic.meebook.'+name,inspectMeeBook(rows,week));}
 return {children:children.length};
}
