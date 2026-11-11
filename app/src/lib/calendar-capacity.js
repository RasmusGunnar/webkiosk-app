// Sizes are measured from the actual rendered rows, including wrapped titles.
// No item-count limit: preserve every row when the complete day fits.
export function fitDayGroups(groups,available,sectionGap,overflowHeight){
 const total=groups.reduce((n,g)=>n+g.rows.length,0)
 const cost=counts=>{
  let height=0,sections=0
  groups.forEach((g,i)=>{if(!counts[i])return;sections++;height+=g.overhead+g.rows.slice(0,counts[i]).reduce((a,b)=>a+b,0)+g.gap*(counts[i]-1)})
  return height+Math.max(0,sections-1)*sectionGap
 }
 const all=groups.map(g=>g.rows.length)
 if(cost(all)<=available+0.25)return {counts:all,hidden:0,height:cost(all)}
 const counts=groups.map(()=>0),limit=Math.max(0,available-overflowHeight-sectionGap)
 // One row per nonempty group per round, in visual order. A tall next row
 // cannot starve a shorter row in another group. Order within a group is kept.
 let added
 do{
  added=false
  groups.forEach((g,i)=>{
   if(counts[i]>=g.rows.length)return
   counts[i]++
   if(cost(counts)<=limit+0.25)added=true
   else counts[i]--
  })
 }while(added)
 return {counts,hidden:total-counts.reduce((a,b)=>a+b,0),height:cost(counts)}
}

const px=value=>Number.parseFloat(value)||0
const setHidden=(node,value)=>{if(node.hidden!==value)node.hidden=value}
const measuredLayouts=new WeakMap()

// The grid height depends only on the viewport, its document position and the
// existing shell's bottom clearance. It never depends on selected row count.
// Called synchronously after DOM insertion, before paint. The application's
// existing resize renderer calls this again; no observer/render feedback loop.
export function fitCalendarWeek(root=document){
 const grid=root.querySelector('.week-grid'),mode=document.body.dataset.mode
 if(!grid||mode==='mobile'||!grid.querySelector('[data-adaptive-day]'))return
 const shell=grid.closest('.app-shell'),style=getComputedStyle(shell)
 if(mode==='desktop'){
  const top=grid.getBoundingClientRect().top+window.scrollY
  const card=grid.querySelector('.day-card'),cardStyle=getComputedStyle(card),header=card.querySelector('.day-card-header'),headerStyle=getComputedStyle(header)
  // A very short screen may scroll, but must still expose its day header and
  // overflow action. Do not retain the old 330px content-independent minimum.
  const min=header.getBoundingClientRect().height+px(headerStyle.marginBottom)+px(cardStyle.paddingTop)+px(cardStyle.paddingBottom)+px(cardStyle.borderTopWidth)+px(cardStyle.borderBottomWidth)+px(getComputedStyle(card.querySelector('.day-overflow')).minHeight)
  const height=Math.max(min,window.innerHeight-top-px(style.paddingBottom))
  if(grid.style.height!==height+'px')grid.style.height=height+'px'
 }
 const rect=grid.getBoundingClientRect(),signature=[rect.width,rect.height,mode,document.fonts?.status].join(':')
 if(measuredLayouts.get(grid)===signature)return
 grid.dataset.adaptive='true'
 for(const card of grid.querySelectorAll('[data-adaptive-day]')){
  const body=card.querySelector('.day-sections'),overflow=body.querySelector('.day-overflow')
  const sections=[...body.querySelectorAll(':scope > .calendar-day-section,:scope > .day-meals')]
  // Measurement writes and reads finish within this same layout/paint turn.
  // Rows remain available in DOM so resizing never needs a data rerender.
  const groups=sections.map(section=>{
   setHidden(section,false)
   const list=section.querySelector('.calendar-items')||section,rows=[...list.children]
   rows.forEach(row=>setHidden(row,false))
   return {section,list,nodes:rows}
  })
  setHidden(overflow,false)
  const measured=groups.map(g=>{
   const gap=px(getComputedStyle(g.list).rowGap),rows=g.nodes.map(n=>n.getBoundingClientRect().height)
   return {...g,rows,gap,overhead:g.section.getBoundingClientRect().height-rows.reduce((a,b)=>a+b,0)-gap*Math.max(0,rows.length-1)}
  })
  const result=fitDayGroups(measured,body.clientHeight,px(getComputedStyle(body).rowGap),overflow.getBoundingClientRect().height)
  measured.forEach((g,i)=>{g.nodes.forEach((n,j)=>setHidden(n,j>=result.counts[i]));setHidden(g.section,result.counts[i]===0)})
  setHidden(overflow,result.hidden===0)
  const label='+ '+result.hidden+' '+overflow.dataset.moreLabel
  if(overflow.textContent!==label)overflow.textContent=label
  const visible=String(measured.reduce((n,g)=>n+g.rows.length,0)-result.hidden),hidden=String(result.hidden)
  if(card.dataset.visibleCount!==visible)card.dataset.visibleCount=visible
  if(card.dataset.hiddenCount!==hidden)card.dataset.hiddenCount=hidden
 }
 measuredLayouts.set(grid,signature)
}
