import {allowanceTasks} from './lib/allowance-model.js'
import {RewardsUI} from './lib/rewards-ui.js'
import {emptyRewards,rewardRule,managedTask,taskComplete,actionPayload,rewardOrigin,rewardConfig,rewardToday} from './lib/rewards-model.js'
import './style.css'
import './product.css'
import './desktop-kiosk.css'
import './mobile.css'
import './rewards.css'
import './polish.css'
import './recipes.css'
import './multiday.css'
import './imported-scopes.css'
import {hiddenImportLabel} from './lib/imported-scopes.js'
import {eventInterval,eventOverlapsDate,eventDisplayRange,eventDayLabel,eventDayState,eventDateRange,validateEventInterval,supportsInterval,daysBetween} from './lib/calendar-interval.js'
import {RecipeService,imageBlob} from './lib/recipe-service.js'
import {RecipeUI} from './lib/recipe-ui.js'
import {recipeId,fromPreview} from './lib/recipe-model.js'
import {compactDay,compactTask,compactMeals,filterRoutes} from './lib/calendar-layout.js'
import {ImportedEditor,visibleImports,canEditImported} from './lib/imported-editor.js'
import { supabase, configurationError, cacheNamespace, clearLocalAuth } from './lib/supabase'
import { findPerson, selectPeople, itemPeople, itemPersonIds, itemMatchesPerson, feedPerson } from './lib/people.js'
import { avatarDisplayUrl, validateAvatar, resolveAvatarUrls, savePerson } from './lib/avatars.js'
import { normalizeFeedUrl, redactFeedUrl, feedIdOf, feedSyncStatus } from './lib/feeds.js'
import { calendarPayload } from './lib/calendar.js'
import { observeSession } from './lib/auth.js'
import { readAllRows } from './lib/rows.js'
import { calendarHeading, preferredView, VIEW_KEY, weekDates, monthDates, isoWeek, addDays, parseDate as parseDateIso } from './lib/calendar-dates.js'
import { materialize, displayTitle, value as calendarValue, imported, sourceLabel, repeatContext, baseFor, itemValues, planCreate, planEdit, planDelete, taskSuggestions } from './lib/calendar-semantics.js'
import { calendarRealtime } from './lib/calendar-realtime.js'
import { LocalStore, DATABASE_NAME } from './lib/local-store.js'
import { OfflineSync } from './lib/offline-sync.js'
import { taskEmoji, taskOccurrenceKey, rewardEnabled } from './lib/task-rewards.js'
import {RewardMotion} from './lib/reward-motion.js'
import { DEVICE_KEY, readDevice, saveDevice, deviceSettings, resolveMode, densityFor, safeShortcut, makePin, checkPin, WakeScreen, DeviceClock } from './lib/device-mode.js'
import { upcomingItems, roleLabel, invitationStatus, callbackUrl, consumeInvite } from './lib/product-model.js'
import { platform, nativeWakeApi } from './lib/platform.js'
import { publicBase, authCallback, inviteLink, parseAppLink, consumeAuthLink } from './lib/app-links.js'
import { installNativeRuntime } from './lib/native-runtime.js'
import { DeviceRegistration } from './lib/device-registration.js'
import { PushNotifications } from '@capacitor/push-notifications'
import { App } from '@capacitor/app'
import { exportFamilyData, clearNativeExports } from './lib/account-data.js'
import { renderPublicPage } from './lib/public-pages.js'
import { calendarOnly, isHouseholdPlan, PLAN_TYPES, mealsOn, shoppingItems, ingredientDrafts, planValues, shoppingCategory } from './lib/household-plans.js'
import { icon, routeLabels, renderNavigation, renderMeals, renderShopping } from './lib/product-ui.js'
import { PlanEditor } from './lib/plan-editor.js'
import { installDialogAccessibility } from './lib/dialog-accessibility.js'

const app = document.querySelector('#app')
const publicUrl=publicBase(import.meta.env,location)
const accountPath=location.pathname==='/delete-account'
const isPublicPage=['/privacy','/support'].includes(location.pathname)
const callback=()=>authCallback({native:platform.native,base:publicUrl})
const devices=supabase&&platform.native?new DeviceRegistration({client:supabase,push:PushNotifications,storage:localStorage,platform,enabled:import.meta.env.VITE_NATIVE_PUSH_ENABLED==='true',onStatus:text=>{const target=document.querySelector('#push-status');if(target)target.textContent=text}}):null
let pendingCalendarLink=parseAppLink(location.href,{base:publicUrl,localOrigin:location.origin})
if(pendingCalendarLink?.kind!=='calendar')pendingCalendarLink=null
let nativeActive=true,nativeResumePending=null,reconnectInFlight=null

const localStore = new LocalStore(DATABASE_NAME + ':' + cacheNamespace)
let syncEngine = null, syncStatus = { offline: !navigator.onLine, syncing: false }
let liveFeedMetadata = [], surfaceFrame = null, syncPanelOpen = false
const expandedTaskDays = new Set()
const syncPanelRoot = document.createElement('div'); document.body.append(syncPanelRoot)
const rewardMotion=new RewardMotion({getPerson:id=>householdPeople.find(p=>p.id===id),claimMilestone:async(pid,month)=>{const {data,error}=await supabase.rpc('claim_reward_milestone',{p_household_id:activeHousehold?.id,p_person_id:pid,p_month_start:month});return !error&&data===true}})
document.addEventListener('keydown', event => { if (event.key === 'Escape' && syncPanelOpen) { syncPanelOpen = false; renderSyncPanel() } })

let sessionEpoch = 0
let authRequestInFlight = false
let householdsLoadFailed = false
let householdRole = null
const pendingAvatarFiles = new Map()
let session = null
let households = []
let activeHousehold = null
let rewardState = emptyRewards(), rewardLoadVersion = 0
let libraryRecipes=[],recipeImages=new Map(),recipeLoadVersion=0,recipeLoadError=''
let calendarItems = []
let calendarLoadVersion = 0
let peopleLoadVersion = 0
let feedsLoadVersion = 0
let calendarItemsHouseholdId = null
let householdPeople = []
let householdPeopleHouseholdId = null
let calendarFeeds = []
let calendarFeedsHouseholdId = null
let activePersonFilter = 'Alle'
let initialAuthError=parseAppLink(location.href,{base:publicUrl,localOrigin:location.origin})?.kind==='auth-error'?'Linket er udløbet eller ugyldigt. Bed om et nyt link.':''
let message=initialAuthError
let isCreatingHousehold = false
let isLoadingCalendar = false
let isLoadingPeople = false
let isLoadingCalendarFeeds = false
let isCreatingCalendarItem = false
let isCalendarModalOpen = false
let editingCalendarItemId = null
let isSettingsModalOpen = false
let isCreatingPerson = false
let settingsMessage = ''
let calendarImportMessage = ''
let isSavingCalendarFeed = false
let importingCalendarFeedId = null
let calendarFeedImportMessages = {}
let hiddenImports=[],hiddenImportsOpen=false,hiddenImportsLoading=false
let editingCalendarFeedId = null
let calendarFeedDraft = createEmptyCalendarFeedDraft()
let calendarViewMode = getDefaultCalendarViewMode()
let calendarCursorDate = new Date()
let hasUserSelectedCalendarView = false
let newCalendarDate = null
let editingCalendarSnapshot = null
let editingRowsSnapshot = []
const realtime = calendarRealtime(supabase, async () => { await refreshHousehold() }, state => {
  const indicator = document.querySelector('#calendar-sync-status')
  if (indicator) {
    indicator.textContent = state === 'SUBSCRIBED' ? '' : 'Forbindelsen genoprettes…'
    indicator.dataset.state = state
  }
})


const deviceKey=DEVICE_KEY+':'+cacheNamespace
let device=readDevice(localStorage,deviceKey)
let shoppingDraft={title:'',note:''},shoppingBusy=false,shoppingOpen=false
let foodRoute='meals'
let productRoute='calendar',settingsTab='people',taskRange='today',newCalendarType='Aktivitet'
let kioskUnlocked=false,pinAttempts=0,pinBlockedUntil=0,members=[],invitations=[]
const rewardsUI=new RewardsUI({getContext:()=>({key:sessionEpoch+':'+activeHousehold?.id,items:calendarItems,people:householdPeople,state:rewardState,role:householdRole,mode:mode(),online:navigator.onLine&&!syncStatus.offline}),onAction:performRewardAction,onSelect:id=>{activePersonFilter=id;setProductRoute('tasks');activePersonFilter=id;updateCalendarSurface()},onToggle:toggleCalendarItemDone,onEdit:openEditCalendarModal,avatar:renderPersonAvatar})
const pinRoot=document.createElement('div');document.body.append(pinRoot)
const createRoot=document.createElement('div');document.body.append(createRoot)
createRoot.addEventListener('dismiss-dialog',()=>{createRoot.innerHTML=''})
const planRoot=document.createElement('div');document.body.append(planRoot)
const detailRoot=document.createElement('div');document.body.append(detailRoot)
detailRoot.addEventListener('dismiss-dialog',()=>{detailRoot.innerHTML=''})
const importedRoot=document.createElement('div');document.body.append(importedRoot)
const importedEditor=new ImportedEditor({root:importedRoot,getContext:()=>sessionEpoch+':'+activeHousehold?.id,getPeople:()=>householdPeople.filter(isActiveHouseholdPerson),
 save:async(item,patch,{scope='occurrence',hide=false})=>{if(!navigator.onLine||syncStatus.offline)throw Error('Forbind til internettet for at gemme ændringer i importerede aftaler.');const engine=syncEngine;engine.writeGeneration++;const {error}=await supabase.rpc('edit_imported_calendar_scope',{p_id:item.id,p_expected:item.updated_at,p_patch:patch,p_scope:scope,p_hide:hide});if(error)throw error;if(engine===syncEngine){engine.writeGeneration++;await refreshHousehold()}},onSaved:()=>updateCalendarSurface()})
const recipeRoot=document.createElement('div');document.body.append(recipeRoot)
const recipeContext=()=>({key:sessionEpoch+':'+activeHousehold?.id,householdId:activeHousehold?.id,recipes:libraryRecipes,people:householdPeople,items:calendarItems,mode:mode(),error:recipeLoadError})
const recipeService=new RecipeService({client:supabase,getContext:recipeContext})
const recipeUI=new RecipeUI({root:recipeRoot,getContext:recipeContext,service:recipeService,refresh:loadRecipes,avatar:p=>renderPersonAvatar(p,'person-avatar recipe-avatar'),onChange:()=>updateCalendarSurface(),notice:text=>{message=text;updateCalendarSurface()},newMeal:date=>planEditor.open('meal',{date}),editMeal:row=>planEditor.open('meal',{id:row.id}),
 planRecipe:async(recipe,fields)=>{const values={...planValues('meal',{title:recipe.title,date:fields.date,note:fields.note}),recipe_id:recipe.id,servings_override:fields.servings_override?Number(fields.servings_override):null};const result=await runCalendarMutation(()=>planCreate(values));if(result.error)throw result.error},
 addShopping:async(recipe,ingredients,{meal,actionId})=>{const rows=ingredients.filter(i=>!calendarItems.some(row=>row.data?.recipe_action_id===actionId&&row.data?.ingredient_id===i.id)).map(i=>({id:crypto.randomUUID(),values:{...planValues('shopping',{title:i.raw_text.slice(0,160),note:i.raw_text.length>160?i.raw_text:'',location:shoppingCategory(i.raw_text)}),recipe_id:recipe.id,meal_id:meal?.id||null,ingredient_id:i.id,ingredient_raw_text:i.raw_text,recipe_action_id:actionId}}));if(!rows.length)return;const result=await runCalendarMutation(()=>({upserts:rows,deleteIds:[],expected:[]}));if(result.error)throw result.error}
})
const planEditor=new PlanEditor({getRecipes:()=>libraryRecipes,chooseRecipe:date=>{planEditor.close();recipeUI.choose(date)},openRecipe:id=>{planEditor.close();recipeUI.detail(id)},root:planRoot,getRows:()=>calendarItems,getContext:()=>sessionEpoch+':'+activeHousehold?.id,
 fetchRecipe:async url=>(await recipeService.import({url})).recipe,
 saveRecipe:async(preview,{id,existing})=>{
  await recipeService.save(fromPreview(preview),{id,existing,image:!existing&&preview.image_copy?imageBlob(preview.image_copy):null,removeImage:!preview.image})
  const {data,error}=await supabase.from('recipes').select('*').eq('id',id).single();if(error)throw error
  await loadRecipes()
  return data
 },
 save:(values,existing)=>runCalendarMutation(()=>existing?planEdit([existing],existing,values):planCreate(values)),
 remove:existing=>runCalendarMutation(()=>({upserts:[],deleteIds:[existing.id],expected:[{id:existing.id,updated_at:existing.updated_at}]})),
 onSaved:()=>{message='Gemt til familien.';updateCalendarSurface()}
})
let pendingInvite=consumeInvite(location,history,sessionStorage)
let authScreen=location.hash.includes('type=recovery')||sessionStorage.getItem('familiekalender.recovery')?'recovery':'login'
const wakeScreen=new WakeScreen({api:nativeWakeApi||navigator.wakeLock,visible:()=>nativeActive&&!document.hidden,onStatus:status=>{const el=document.querySelector('#wake-status');if(el)el.textContent=status}})
let lastClockMinute=''
const clock=new DeviceClock({
 onTick:now=>{
   const time=document.querySelector('#device-clock'),date=document.querySelector('#device-date')
   const text=new Intl.DateTimeFormat('da-DK',{hour:'2-digit',minute:'2-digit'}).format(now)
   if(time&&time.textContent!==text)time.textContent=text
   const dateText=new Intl.DateTimeFormat('da-DK',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now)
   if(date&&date.textContent!==dateText)date.textContent=dateText
   const minute=toDateIso(now)+text
   if(lastClockMinute!==minute){lastClockMinute=minute;if(session&&productRoute==='today')scheduleCalendarSurface()}
 },
 onDay:now=>{if(session&&(mode()==='kiosk'||['today','tasks'].includes(productRoute))){calendarCursorDate=now;render({preserveDialogs:true})}},
 onIdle:()=>{if(productRoute!=='today'||activePersonFilter!=='Alle')setProductRoute('today')},
 isKiosk:()=>mode()==='kiosk',
 isBusy:()=>recipeUI.opened||rewardsUI.opened||isCalendarModalOpen||isSettingsModalOpen||planEditor.opened||importedEditor.opened||!!detailRoot.firstChild||Boolean(createRoot.firstChild)||Boolean(pinRoot.firstChild)||syncPanelOpen,
 timeout:()=>settingsForDevice().inactivity
})
function preferredHousehold(fallback) {
 return households.find(h=>device.kiosk?.userId===session?.user.id&&h.id===device.kiosk?.householdId)||fallback
}

async function init() {
  installProductRuntime()
  void clearNativeExports().catch(()=>{})
  if (!platform.native && import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {})
  if(isPublicPage){app.innerHTML=renderPublicPage(location.pathname);return}
  if (configurationError) { app.innerHTML = '<main class="app-shell"><p>' + escapeHtml(configurationError) + '</p></main>'; return }

  if(devices){try{const info=await App.getInfo();devices.appVersion=info.version+' ('+info.build+')'}catch{}}
  try {
    const remembered = await localStore.get('last-session')
    if (remembered) await applySession({ user: { id: remembered.user_id }, offlineOnly: true }, 'OFFLINE')
  } catch { message = 'Lokallagring er utilgængelig. Offlineændringer kan ikke gemmes.' }
  observeSession(supabase, async (next, event) => {
    if(event==='PASSWORD_RECOVERY'){authScreen='recovery';sessionStorage.setItem('familiekalender.recovery','1')}
    if (!next && !navigator.onLine && session) return
    await applySession(next, event)
    if(event==='PASSWORD_RECOVERY')render()
  }, error => { message = 'Login kunne ikke indlæses: ' + error.message; if (!session) render() })
  await installNativeRuntime({onUrl:handleAppUrl,onResume:async()=>{
    nativeActive=true;clock.tick();await wakeScreen.visibility()
    supabase.auth.startAutoRefresh()
    if(!nativeResumePending)nativeResumePending=Promise.all([reconnectCalendar(),devices?.resume()]).finally(()=>nativeResumePending=null)
    await nativeResumePending
  },onPause:async()=>{nativeActive=false;realtime.stop();supabase.auth.stopAutoRefresh();await wakeScreen.visibility()},onBack:handleNativeBack})
  window.addEventListener('offline', () => { syncEngine?.emit(); realtime.stop(); updateCalendarSurface() })
  window.addEventListener('online', reconnectCalendar)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnectCalendar() })
  window.matchMedia('(max-width: 699px)').addEventListener('change', () => { if (session) render({ preserveDialogs: true }) })
  setInterval(() => { if (session && navigator.onLine && syncEngine?.state.queue.some(row => ['pending','sending'].includes(row.status))) reconnectCalendar() }, 15000)
  setInterval(async () => {
    if (!session || !activeHousehold || !navigator.onLine) return
    await loadHouseholdPeople()
  }, 45 * 60 * 1000)
}

async function applySession(nextSession) {
  if (session?.user?.id === nextSession?.user?.id && session !== null) {
    const wasOffline = session.offlineOnly; session = nextSession
    if (wasOffline && !nextSession.offlineOnly) {
      await loadHouseholds()
      const chosen = preferredHousehold(households.find(h => h.id === activeHousehold?.id) || households[0])
      if (chosen && chosen.id !== activeHousehold?.id) await activateHousehold(chosen)
      else if (!chosen && !householdsLoadFailed) { syncEngine?.stop(); syncEngine = null; activeHousehold = null }
      render({preserveDialogs:true}); await reconnectCalendar()
    }
    return
  }
  const previousId = session?.user?.id
  clearSessionState()
  if (previousId && nextSession && previousId !== nextSession.user.id) await localStore.clearUser(previousId)
  session = nextSession
  const epoch = sessionEpoch
  if (!session) { if(initialAuthError){message=initialAuthError;initialAuthError='';history.replaceState(null,'','/')} render(); return }
  try {
    const cached = await localStore.get('user:' + session.user.id)
    households = cached?.households || []
    if (households.length) { await activateHousehold(preferredHousehold(households.find(h => h.id === cached.activeHouseholdId) || households[0])); render() }
    if (nextSession.offlineOnly) { if (!households.length) render(); return }
    await loadHouseholds()
    if (epoch !== sessionEpoch) return
    const chosen = preferredHousehold(households.find(h => h.id === activeHousehold?.id) || households[0])
    if (chosen && chosen.id !== activeHousehold?.id) await activateHousehold(chosen)
    else if (!chosen) { activeHousehold = null; syncEngine?.stop(); syncEngine = null }
    render()
    if (activeHousehold && navigator.onLine) await refreshHousehold()
  } catch (error) { message = error.message; render() }
}
async function activateHousehold(household) {
  rewardsUI.close(true);rewardState=emptyRewards();
  realtime.stop(); syncEngine?.stop(); rewardMotion.reset()
  syncPanelOpen = false; syncPanelRoot.innerHTML = ''
  activeHousehold = household; householdRole = household.memberRole; rewardMotion.reset(household.id)
  members=[];invitations=[];kioskUnlocked=false;pinRoot.innerHTML=''
  createRoot.innerHTML='';foodRoute='meals';planEditor.close(true);importedEditor.close(true);recipeUI.close(true);libraryRecipes=[];recipeImages.clear();recipeLoadVersion++;recipeLoadError='';detailRoot.innerHTML='';shoppingDraft={title:'',note:''};shoppingOpen=false
  const rememberedRoute=settingsForDevice().lastRoute
  productRoute=mode()!=='kiosk'&&routeLabels[rememberedRoute]?rememberedRoute:'today'
  if(['meals','shopping','recipes'].includes(productRoute))foodRoute=productRoute
  calendarViewMode=productRoute==='today'?'day':getDefaultCalendarViewMode()
  void wakeScreen.set(mode()==='kiosk'&&settingsForDevice().wake)
  calendarItems = []; householdPeople = []; calendarFeeds = []; liveFeedMetadata = []
  activePersonFilter = 'Alle'; calendarCursorDate = new Date()
  editingCalendarSnapshot = null; isCalendarModalOpen = false; isSettingsModalOpen = false
  const id = household.id, epoch = sessionEpoch
  syncEngine = new OfflineSync({ store: localStore, client: supabase, userId: session.user.id, householdId: id,
    onChange: (view, queue, status) => {
      if (epoch !== sessionEpoch || activeHousehold?.id !== id) return
      const avatars = new Map(householdPeople.map(person => [person.id, person.avatar_display_url]))
      calendarItems = visibleImports(view.items).map(row=>{const master=(view.recipes||[]).find(r=>r.id===recipeId(row));return row.type===PLAN_TYPES.meal&&master?{...row,title:master.title,data:{...row.data,title:master.title}}:row})
      rewardState = view.rewards||emptyRewards()
      libraryRecipes=(view.recipes||[]).map(r=>({...r,image_display_url:recipeImages.get(r.image_path)||''}))
      householdPeople = view.people.map(person => ({...person, role:mapPersonRoleToUi(person.role), avatar_display_url: avatars.get(person.id)}))
      calendarFeeds = view.feeds.map(feed => ({...feed, ...(navigator.onLine ? liveFeedMetadata.find(row => row.id === feed.id) : {})}))
      calendarItemsHouseholdId = householdPeopleHouseholdId = calendarFeedsHouseholdId = id
      syncStatus = status; rewardMotion.observe(syncEngine?.state.snapshot.rewards||emptyRewards()); syncActivePersonFilter(); scheduleCalendarSurface()
    },
  })
  await syncEngine.init()
  if(!navigator.onLine)rewardMotion.hydrate(syncEngine.state.snapshot.rewards)
  await rememberHouseholds()
  if(!session.offlineOnly)void devices?.attach(session.user.id,household.id)
}
async function rememberHouseholds() {
  if (!session) return
  const data = { user_id: session.user.id, households, activeHouseholdId: activeHousehold?.id }
  await localStore.put('user:' + session.user.id, data)
  await localStore.put('last-session', { user_id: session.user.id })
}
async function refreshHousehold() {
  if (!session || !activeHousehold || !navigator.onLine) return
  const engine = syncEngine
  await Promise.all([loadCalendarItems(), loadHouseholdPeople(), loadCalendarFeeds(), loadRewardsV2(), loadRecipes()])
  if (engine !== syncEngine) return
  await engine?.replay()
  if (engine === syncEngine) {updateCalendarSurface();applyCalendarLink()}
}
async function reconnectCalendar() {
  if (!nativeActive || !navigator.onLine || !session || session.offlineOnly || !activeHousehold) return
  const id=activeHousehold.id,epoch=sessionEpoch,userId=session.user.id
  if(reconnectInFlight?.id===id)return reconnectInFlight.promise
  const current={id,promise:null};reconnectInFlight=current
  current.promise=(async()=>{
   if(devices&&devices.context?.householdId!==id)await devices.attach(userId,id)
   if(epoch!==sessionEpoch||activeHousehold?.id!==id)return
   realtime.start(id);await refreshHousehold()
  })().finally(()=>{if(reconnectInFlight===current)reconnectInFlight=null})
  return current.promise
}

function clearSessionState() {
  rewardsUI.close(true);rewardState=emptyRewards();rewardLoadVersion++
  void wakeScreen.set(false);pinRoot.innerHTML='';createRoot.innerHTML='';foodRoute='meals';planEditor.close(true);importedEditor.close(true);recipeUI.close(true);libraryRecipes=[];recipeImages.clear();recipeLoadVersion++;recipeLoadError='';detailRoot.innerHTML='';shoppingDraft={title:'',note:''};shoppingOpen=false;kioskUnlocked=false;members=[];invitations=[]
  realtime.stop(); syncEngine?.stop(); syncEngine = null; rewardMotion.reset()
  syncPanelOpen = false; syncPanelRoot.innerHTML = ''; liveFeedMetadata = []; expandedTaskDays.clear()
  editingCalendarSnapshot = null; editingRowsSnapshot = []
  sessionEpoch++;reconnectInFlight=null
  session = null
  households = []; activeHousehold = null; householdRole = null
  calendarItems = []; calendarItemsHouseholdId = null
  householdPeople = []; householdPeopleHouseholdId = null
  calendarFeeds = []; calendarFeedsHouseholdId = null
  activePersonFilter = 'Alle'
  isLoadingCalendar = false; isLoadingPeople = false; isLoadingCalendarFeeds = false
  isCalendarModalOpen = false; editingCalendarItemId = null; isSettingsModalOpen = false
  isCreatingPerson = false; isCreatingCalendarItem = false; isCreatingHousehold = false
  isSavingCalendarFeed = false; importingCalendarFeedId = null
  settingsMessage = ''; calendarImportMessage = ''; calendarFeedImportMessages = {}
  hiddenImports=[];hiddenImportsOpen=false;hiddenImportsLoading=false
  editingCalendarFeedId = null; calendarFeedDraft = createEmptyCalendarFeedDraft()
  pendingAvatarFiles.clear()
  calendarCursorDate = new Date(); message = ''; householdsLoadFailed = false
}
function canManageFeeds() { return ['owner', 'admin'].includes(householdRole) }

function render({ preserveDialogs = false } = {}) {
  if(isPublicPage){app.innerHTML=renderPublicPage(location.pathname);return}
  if(accountPath&&session&&authScreen!=='recovery'){renderAccountPage();return}
  applyDeviceAppearance()
  if(authScreen==='recovery'&&document.querySelector('#recovery-form'))return
  if (!session || authScreen==='recovery') {
    renderLogin()
    return
  }

  if (activeHousehold) {
    renderDashboard(preserveDialogs)
    return
  }

  renderCreateFirstHousehold()
}

function renderPreservingSettingsScroll() {
  const settingsModal = document.querySelector('.settings-modal')
  const scrollTop = settingsModal ? settingsModal.scrollTop : null

  render()

  if (scrollTop !== null) {
    const nextSettingsModal = document.querySelector('.settings-modal')

    if (nextSettingsModal) {
      nextSettingsModal.scrollTop = scrollTop
    }
  }
}

function renderLogin() {
 const recovery=authScreen==='recovery',reset=authScreen==='reset',signup=authScreen==='signup'
 const heading=recovery?'Vælg ny adgangskode':reset?'Glemt adgangskode?':signup?'Opret din konto':'Velkommen hjem'
 app.innerHTML='<main class="app-shell auth-shell"><section class="panel auth-panel"><p class="eyebrow">Familiekalender</p><h1>'+heading+'</h1>'+
 (pendingInvite?'<p class="hint">Log ind med invitationens email for at blive en del af familien.</p>':'')+
 (recovery?'<form id="recovery-form" class="stack-form"><label for="new-password">Ny adgangskode</label><input id="new-password" name="password" type="password" minlength="8" required autocomplete="new-password"><label for="repeat-password">Gentag adgangskode</label><input id="repeat-password" name="repeat" type="password" minlength="8" required autocomplete="new-password"><button type="submit">Gem adgangskode</button></form>':
 reset?'<form id="reset-form" class="stack-form"><p>Vi sender et link, så du kan vælge en ny adgangskode.</p><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email"><button type="submit">Send nulstillingslink</button></form>':
 '<div class="auth-tabs"><button data-auth-screen="login" aria-pressed="'+!signup+'">Har en konto</button><button data-auth-screen="signup" aria-pressed="'+signup+'">Ny bruger</button></div><form id="login-form" class="stack-form"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email"><label for="password">Adgangskode</label><div class="password-field"><input id="password" name="password" type="password" required '+(signup?'minlength="8" autocomplete="new-password"':'autocomplete="current-password"')+'><button id="show-password" type="button" aria-label="Vis adgangskode">Vis</button></div><button type="submit" name="authAction" value="'+(signup?'signup':'login')+'">'+(signup?'Opret bruger':'Log ind')+'</button></form><button class="text-button" data-auth-screen="reset">Glemt adgangskode?</button>')+
 '<p id="message" class="message" role="status">'+escapeHtml(message)+'</p>'+((reset||recovery)?'<button data-auth-screen="login" class="text-button">'+(session?'Tilbage til kalender':'Tilbage til login')+'</button>':'')+'<p class="legal-links"><a href="/privacy">Privatliv</a> · <a href="/support">Support</a></p></section></main>'
 document.querySelectorAll('[data-auth-screen]').forEach(button=>button.onclick=()=>{authScreen=button.dataset.authScreen;message='';render()})
 document.querySelector('#login-form')?.addEventListener('submit',handleLogin)
 document.querySelector('#show-password')?.addEventListener('click',event=>{const input=document.querySelector('#password');input.type=input.type==='password'?'text':'password';event.target.textContent=input.type==='password'?'Vis':'Skjul';event.target.setAttribute('aria-label',input.type==='password'?'Vis adgangskode':'Skjul adgangskode')})
 document.querySelector('#reset-form')?.addEventListener('submit',async event=>{
   event.preventDefault();const button=event.target.querySelector('button');button.disabled=true
   const {error}=await supabase.auth.resetPasswordForEmail(new FormData(event.target).get('email'),{redirectTo:callback()})
   message=error?'Linket kunne ikke sendes. Prøv igen om lidt.':'Hvis emailen har en konto, har vi sendt et link. Tjek også spam.'
   document.querySelector('#message').textContent=message;button.disabled=false
 })
 document.querySelector('#recovery-form')?.addEventListener('submit',async event=>{
   event.preventDefault();const data=new FormData(event.target),button=event.target.querySelector('button')
   if(data.get('password')!==data.get('repeat')){document.querySelector('#message').textContent='Adgangskoderne er ikke ens.';return}
   button.disabled=true
   const {error}=await supabase.auth.updateUser({password:String(data.get('password'))})
   if(error){document.querySelector('#message').textContent='Adgangskoden kunne ikke ændres. Linket kan være udløbet; bed om et nyt link.';button.disabled=false;return}
   sessionStorage.removeItem('familiekalender.recovery');history.replaceState(null,'','/');authScreen='login';message='Adgangskode opdateret.';render()
 })
}


function renderCreateFirstHousehold() {
  if (householdsLoadFailed) {
    app.innerHTML = '<main class="app-shell"><p>' + escapeHtml(message) + '</p><button id="retry-households">Prøv igen</button><button id="logout-button">Log ud</button></main>'
    document.querySelector('#retry-households').onclick = async () => { await loadHouseholds(); if (households[0]) await activateHousehold(households[0]); render(); await refreshHousehold() }
    document.querySelector('#logout-button').onclick = handleLogout
    return
  }
  app.innerHTML = `
    <main class="app-shell">
      <header class="dashboard-header">
        <div>
          <h1>Familiekalender</h1>
          <p>Logget ind som ${escapeHtml(session.user.email)}</p>
        </div>
        <button id="logout-button" type="button">Log ud</button>
      </header>

      <section class="panel">
        <h2>Din familie</h2>
        <ul id="households-list">
          <li>Du er endnu ikke tilknyttet en familie.</li>
        </ul>
      </section>

      ${renderInvitation()}
      <form id="household-form" class="panel stack-form">
        <h2>Opret familie</h2>
        <label for="household-name">Navn</label>
        <input id="household-name" name="name" type="text" required />
        <button type="submit">Opret familie</button>
      </form>

      <p id="message" class="message">${escapeHtml(message)}</p>
    </main>
  `

  document.querySelector('#logout-button')?.addEventListener('click', handleLogout)
  document.querySelector('#household-form').addEventListener('submit', handleCreateHousehold)
  document.querySelector('#accept-invite')?.addEventListener('click',acceptInvitation)
}

function renderDashboard(preserveDialogs = false) {
  const inlineFocus=captureInlineFocus()
  const savedCalendarModal = preserveDialogs && isCalendarModalOpen ? document.querySelector('#calendar-modal') : null
  const savedSettingsModal = preserveDialogs && isSettingsModalOpen ? document.querySelector('#settings-modal') : null
  const activeInput = document.activeElement
  const restoreInput = activeInput && (savedCalendarModal?.contains(activeInput) || savedSettingsModal?.contains(activeInput))
  const selection = restoreInput && typeof activeInput.selectionStart === 'number'
    ? [activeInput.selectionStart, activeInput.selectionEnd] : null
  const dialogScroll = [savedCalendarModal, savedSettingsModal].filter(Boolean).map(modal => {
    const panel = modal.firstElementChild
    return [panel, panel.scrollTop]
  })
  syncDefaultCalendarViewMode()

  const householdId = getHouseholdId(activeHousehold)
  if (navigator.onLine && !session.offlineOnly) realtime.start(householdId)
  const toggleViewLabel = calendarViewMode === 'week' ? 'Vis dag' : 'Vis uge'
  const navUnit = calendarViewMode === 'week' ? 'uge' : 'dag'

  if (calendarItemsHouseholdId !== householdId && !isLoadingCalendar) {
    loadCalendarItems({ renderAfter: true })
  }

  if (householdPeopleHouseholdId !== householdId && !isLoadingPeople) {
    loadHouseholdPeople({ renderAfter: true })
  }

  if (calendarFeedsHouseholdId !== householdId && !isLoadingCalendarFeeds) {
    loadCalendarFeeds({ renderAfter: true })
  }

  app.innerHTML = `
    <main class="app-shell">
      <header class="dashboard-header">
${renderProductHeader()}
      </header>

      <div id="sync-status" class="sync-status">${renderSyncStatus()}</div>
      ${(mode()!=='kiosk'&&productRoute==='family') && households.length > 1 ? '<label class="household-switch">Familie <select id="household-switch">' + households.map(h => '<option value="' + h.id + '" ' + (h.id === activeHousehold.id ? 'selected' : '') + '>' + escapeHtml(h.name) + '</option>').join('') + '</select></label>' : ''}
      ${renderProductNav()}
      ${renderInvitation()}
      ${filterRoutes.includes(productRoute)?renderPersonChips():''}

      <section class="calendar-section">
        <div class="section-heading calendar-heading">
          <div>
            <h2>${['meals','shopping','recipes'].includes(productRoute)?'Mad & indkøb':routeLabels[productRoute]||'Kalender'}</h2>
            <p id="calendar-heading-label">${escapeHtml(['today','calendar','tasks'].includes(productRoute)?getCalendarHeaderLabel():({meals:'Planlæg ugens aftensmad',shopping:'Én fælles liste, uanset hvem der handler',family:'Menneskerne bag alle planerne'}[productRoute]||''))}</p>
            <small id="calendar-sync-status" role="status"></small>
          </div>
          <div class="calendar-toolbar" ${productRoute!=='calendar'?'hidden':''}>
            <div class="calendar-nav">
              <button id="calendar-prev-button" type="button" aria-label="Forrige ${navUnit}">${mode()==='mobile'?'←':'Forrige '+navUnit}</button>
              <button id="calendar-today-button" type="button">I dag</button>
              <button id="calendar-next-button" type="button" aria-label="Næste ${navUnit}">${mode()==='mobile'?'→':'Næste '+navUnit}</button>
            </div>
            ${mode()==='mobile'?'<div class="mobile-view-switch" aria-label="Kalendervisning">'+['day','week'].map(view=>'<button type="button" data-calendar-view="'+view+'" aria-pressed="'+(calendarViewMode===view)+'">'+(view==='day'?'Dag':'Uge')+'</button>').join('')+'</div>':'<button id="calendar-toggle-view-button" type="button">'+toggleViewLabel+'</button>'}
          </div>
        </div>
        <div id="calendar-view">${renderCalendarView()}</div>
      </section>

      <div class="ux-notice" ${message?'':'hidden'}><p id="message" class="message" role="status">${escapeHtml(message)}</p><button id="dismiss-message" type="button" aria-label="Luk besked">×</button></div>
      <button id="new-calendar-button" class="floating-new-button" type="button" aria-label="Opret ny" ${mode()==='kiosk'?'hidden':''}>${icon('plus')}<span>Ny</span></button>
      <button id="settings-button" class="floating-settings-button" type="button" ${mode()!=='kiosk'?'hidden':''} aria-label="Indstillinger" title="Indstillinger">${icon('settings')}</button>
      ${renderCalendarModal()}
      ${renderSettingsModal()}
    </main>
  `

  document.querySelector('#logout-button')?.addEventListener('click', handleLogout)
  if (savedCalendarModal) document.querySelector('#calendar-modal')?.replaceWith(savedCalendarModal)
  if (savedSettingsModal) document.querySelector('#settings-modal')?.replaceWith(savedSettingsModal)
  for (const [panel, scrollTop] of dialogScroll) panel.scrollTop = scrollTop
  if (restoreInput) { activeInput.focus({ preventScroll: true }); if (selection) activeInput.setSelectionRange(...selection) }
  document.querySelector('#new-calendar-button').addEventListener('click', openCreateSheet)
  document.querySelector('#calendar-today-button').addEventListener('click', () => { calendarCursorDate = new Date(); render() })
  bindCalendarSurface()
  document.querySelector('#household-switch')?.addEventListener('change', async event => { await activateHousehold(households.find(h => h.id === event.target.value)); render(); await refreshHousehold() })
  document.querySelector('#settings-button').addEventListener('click', openSettingsModal)
  document.querySelector('#calendar-prev-button').addEventListener('click', () => navigateCalendar(-1))
  document.querySelector('#calendar-next-button').addEventListener('click', () => navigateCalendar(1))
  document.querySelector('#calendar-toggle-view-button')?.addEventListener('click', toggleCalendarViewMode)
  document.querySelectorAll('[data-calendar-view]').forEach(button=>button.onclick=()=>{if(button.dataset.calendarView!==calendarViewMode)toggleCalendarViewMode()})

  const modalForm = document.querySelector('#calendar-modal-form')
  const modalBackdrop = document.querySelector('#calendar-modal')
  const settingsForm = document.querySelector('#people-settings-form')
  const calendarFeedForm = document.querySelector('#calendar-feed-form')
  const settingsBackdrop = document.querySelector('#settings-modal')

  if (modalForm && !savedCalendarModal) {
    modalForm.addEventListener('submit', handleSaveCalendarItem)
    document.querySelector('#calendar-modal-close').addEventListener('click', closeCalendarModal)
    document.querySelector('#calendar-modal-cancel').addEventListener('click', closeCalendarModal)
    document.querySelector('#calendar-modal-delete')?.addEventListener('click', handleDeleteCalendarItem)
    document.querySelector('#calendar-type').addEventListener('change', updateModalTypeFields)
    document.querySelector('#calendar-all-day').addEventListener('change', updateIntervalFields)
    const startInput=document.querySelector('#calendar-date'),endInput=document.querySelector('#calendar-end-date');let previousStart=startInput.value
    startInput.addEventListener('change',()=>{if(endInput.value===previousStart)endInput.value=startInput.value;previousStart=startInput.value})
    document.querySelectorAll('[data-calendar-person-choice]').forEach((input) => {
      input.addEventListener('change', handleCalendarPersonChoice)
    })
    document.querySelectorAll('[name="repeatScope"]').forEach(input => input.addEventListener('change', updateModalScopeFields))
    updateModalTypeFields()
    updateModalScopeFields()
  }

  if (modalBackdrop && !savedCalendarModal) {
    modalBackdrop.addEventListener('click', (event) => {
      if (event.target === modalBackdrop) {
        closeCalendarModal()
      }
    })
  }

  if (settingsForm && !savedSettingsModal) {
    settingsForm.addEventListener('submit', handleSavePeopleSettings)
    const rewardChoice = document.querySelector('#person-reward-enabled')
    rewardChoice.onchange = () => { rewardChoice.dataset.explicit = 'true' }
    document.querySelector('#person-role').onchange = event => { if (!rewardChoice.dataset.explicit) rewardChoice.checked = event.target.value === 'barn' }
    document.querySelector('#settings-modal-close').addEventListener('click', closeSettingsModal)
    document.querySelectorAll('[data-person-avatar-file]').forEach((input) => {
      input.addEventListener('change', handlePersonAvatarPreview)
    })
    document.querySelectorAll('[data-person-color-input]').forEach((input) => {
      input.addEventListener('input', handlePersonColorPreview)
    })
    document.querySelectorAll('[data-person-name-input]').forEach((input) => {
      input.addEventListener('input', handlePersonInitialPreview)
    })
    document.querySelectorAll('[data-save-person]').forEach((button) => {
      button.addEventListener('click', () => handleSavePersonRow(button.dataset.savePerson))
    })
  }

  if (!savedSettingsModal) {
  document.querySelector('#hidden-imports-open')?.addEventListener('click',()=>void loadHiddenImports())
  document.querySelectorAll('[data-restore-import]').forEach(button=>button.onclick=()=>void restoreHiddenImport(Number(button.dataset.restoreImport)))
  document.querySelector('#add-calendar-feed-button')?.addEventListener('click', openCreateCalendarFeedForm)

  document.querySelectorAll('[data-edit-calendar-feed]').forEach((button) => {
    button.addEventListener('click', () => openEditCalendarFeedForm(button.dataset.editCalendarFeed))
  })

  document.querySelectorAll('[data-import-calendar-feed]').forEach((button) => {
    button.addEventListener('click', handleImportCalendarFeed)
  })

  document.querySelectorAll('[data-go-to-imported-calendar-feed]').forEach((button) => {
    button.addEventListener('click', () => handleGoToImportedCalendarFeed(button.dataset.goToImportedCalendarFeed))
  })

  document.querySelectorAll('[data-delete-calendar-feed]').forEach((button) => {
    button.addEventListener('click', () => handleDeleteCalendarFeed(button.dataset.deleteCalendarFeed))
  })

  if (calendarFeedForm) {
    calendarFeedForm.addEventListener('submit', handleSaveCalendarFeed)
    calendarFeedForm.querySelectorAll('[data-calendar-feed-field]').forEach((input) => {
      const eventName = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input'
      input.addEventListener(eventName, handleCalendarFeedDraftInput)
    })
    document.querySelector('#calendar-feed-source').addEventListener('change', handleCalendarFeedSourceChange)
    document.querySelector('#calendar-feed-cancel').addEventListener('click', closeCalendarFeedForm)
  }

  }

  if (settingsBackdrop && !savedSettingsModal) {
    settingsBackdrop.addEventListener('click', (event) => {
      if (event.target === settingsBackdrop) {
        closeSettingsModal()
      }
    })
  }
  if(!isCalendarModalOpen&&!isSettingsModalOpen&&!pinRoot.firstChild&&activeInput?.id)document.getElementById(activeInput.id)?.focus({preventScroll:true})
  bindProductControls(!savedSettingsModal);restoreInlineFocus(inlineFocus)
  if(isSettingsModalOpen && settingsTab==='family')void loadMemberships()
}

function scheduleCalendarSurface() {
  if (surfaceFrame) return
  surfaceFrame = requestAnimationFrame(() => { surfaceFrame = null; updateCalendarSurface() })
}
function updateCalendarSurface() {
  if (!session || !activeHousehold || !document.querySelector('#calendar-view')) return
  const inlineFocus=captureInlineFocus()
  for(const feed of calendarFeeds){const status=document.querySelector('[data-feed-status="'+feed.id+'"]');if(status)status.textContent=feedSyncStatus(feed)}
  document.querySelector('#calendar-view').innerHTML = renderCalendarView()
  const chips = document.querySelector('#person-chipbar')
  if (chips) {
    const scrollLeft=chips.scrollLeft,focused=chips.contains(document.activeElement)?document.activeElement.dataset.personFilter:null
    chips.outerHTML=renderPersonChips()
    const next=document.querySelector('#person-chipbar');next.scrollLeft=scrollLeft
    if(focused)[...next.children].find(button=>button.dataset.personFilter===focused)?.focus({preventScroll:true})
  }
  document.querySelector('#sync-status').innerHTML = renderSyncStatus()
  document.querySelector('#message').textContent = message
  const notice=document.querySelector('.ux-notice');if(notice)notice.hidden=!message
  bindCalendarSurface();bindProductSurface();restoreInlineFocus(inlineFocus);rewardsUI.refresh();rewardMotion.present()
  if (syncPanelOpen) renderSyncPanel()
}
function bindCalendarSurface() {
  document.querySelectorAll('[data-task-detail]').forEach(b=>b.onclick=()=>{const item=findRenderableCalendarItem(b.dataset.taskDetail);if(item){detailRoot.innerHTML='';rewardsUI.taskDetail(item,activePersonFilter)}})

  const chips=document.querySelector('#person-chipbar')
  if(chips){const updateEdge=()=>chips.classList.toggle('has-more',chips.scrollWidth-chips.clientWidth-chips.scrollLeft>2);chips.onscroll=updateEdge;updateEdge()}
  document.querySelectorAll('[data-calendar-toggle]').forEach(checkbox => checkbox.onchange = () => toggleCalendarItemDone(checkbox.dataset.calendarToggle,checkbox.checked))
  document.querySelectorAll('[data-calendar-item]').forEach(card => {
    card.onclick = event => { if (!event.target.closest('[data-calendar-toggle], .done-toggle')) openEditCalendarModal(card.dataset.calendarItem) }
    card.onkeydown = event => { if (event.target===card && ['Enter',' '].includes(event.key)) {event.preventDefault();openEditCalendarModal(card.dataset.calendarItem)} }
  })
  document.querySelectorAll('[data-person-filter]').forEach(button => button.onclick = () => {activePersonFilter=button.dataset.personFilter;updateCalendarSurface()})
  document.querySelectorAll('[data-completed-date]').forEach(details => details.ontoggle = () => {
    if(details.open)expandedTaskDays.add(details.dataset.completedDate);else expandedTaskDays.delete(details.dataset.completedDate)
  })
  document.querySelector('#sync-details-button')?.addEventListener('click', () => {syncPanelOpen=true;renderSyncPanel()})
}
function renderSyncStatus() {
  const queue=syncEngine?.state.queue||[], problems=queue.filter(row=>['conflict','error'].includes(row.status)).length
  const offline=!navigator.onLine||syncStatus.offline
  const label=problems?problems+' ændringer kræver dit valg':offline?'Offline · ændringer gemmes lokalt':syncStatus.syncing?'Synkroniserer…':queue.length?queue.length+' ændringer venter på synkronisering':''
  return '<span role="status">'+escapeHtml(label)+'</span>'+(queue.length?'<button id="sync-details-button" class="sync-details-button">Se ændringer</button>':'')
}
function renderSyncPanel() {
  if(!syncPanelOpen){syncPanelRoot.innerHTML='';return}
  const rows=syncEngine?.state.queue||[]
  syncPanelRoot.innerHTML='<div class="modal-backdrop" id="sync-panel-backdrop" role="dialog" aria-modal="true" aria-label="Synkronisering"><div class="calendar-modal"><header class="modal-header"><h2>Synkronisering</h2><button id="sync-panel-close" class="icon-button" aria-label="Luk">×</button></header>'+
    (rows.length?rows.map(row=>{
      const title=row.payload.reward_action?.optimistic?.title||row.payload.p_upserts.at(-1)?.title||'Sletning af aftale'
      const current=syncEngine.state.snapshot.items.find(item=>item.id===row.payload.p_upserts.at(-1)?.id)
      return '<article class="sync-problem"><strong>'+escapeHtml(title)+'</strong><p>'+escapeHtml(row.error||'Venter på synkronisering')+'</p>'+
        (row.status==='conflict'?'<p>Server: '+escapeHtml(current?.title||'Aftalen er slettet eller ændret')+'</p><p>Behold min version gemmer dine felter oven på den aktuelle serverversion. Brug serverversion kasserer også efterfølgende lokale ændringer, der afhænger af denne.</p><button data-sync-choice="local" data-sync-id="'+row.id+'">Behold min version</button><button data-sync-choice="server" data-sync-id="'+row.id+'">Brug serverversion</button>':
          row.status==='error'?'<button data-sync-retry>Prøv igen</button><button data-sync-choice="server" data-sync-id="'+row.id+'">Brug serverversion</button>':'')+'</article>'
    }).join(''):'<p>Alle ændringer er synkroniseret.</p>')+'</div></div>'
  syncPanelRoot.querySelector('#sync-panel-close').onclick=()=>{syncPanelOpen=false;renderSyncPanel()}
  syncPanelRoot.querySelector('#sync-panel-backdrop').onclick=event=>{if(event.target===event.currentTarget){syncPanelOpen=false;renderSyncPanel()}}
  syncPanelRoot.querySelectorAll('[data-sync-choice]').forEach(button=>button.onclick=async()=>{
    button.disabled=true
    try{await syncEngine.resolve(button.dataset.syncId,button.dataset.syncChoice);await loadCalendarItems()}catch(error){message=error.message}
    updateCalendarSurface()
  })
  syncPanelRoot.querySelector('[data-sync-retry]')?.addEventListener('click',()=>syncEngine.retry())
}
function renderDayItems(section,items,date) {
  if(section!=='Opgave'||!(mode()==='kiosk'||mode()==='mobile'))return items.length?items.map(renderCalendarItemCard).join(''):'<p class="empty-section">Ingen</p>'
  const open=items.filter(item=>!taskComplete(item,householdPeople,rewardState,activePersonFilter)),completed=items.filter(item=>taskComplete(item,householdPeople,rewardState,activePersonFilter))
  return (open.length?open.map(renderCalendarItemCard).join(''):'<p class="empty-section">Ingen åbne opgaver</p>')+
    (completed.length?'<details class="completed-tasks" data-completed-date="'+date+'" '+(expandedTaskDays.has(date)?'open':'')+'><summary>'+completed.length+' udførte opgaver</summary>'+completed.map(renderCalendarItemCard).join('')+'</details>':'')
}

function renderCalendarView() {
  if(productRoute==='today')return renderHome()
  if(productRoute==='tasks')return renderTaskView()
  if(productRoute==='recipes')return renderFoodTabs()+recipeUI.renderLibrary()
  if(productRoute==='meals')return renderFoodTabs()+renderMeals(calendarItems,calendarCursorDate,mode()==='kiosk',true,libraryRecipes)+recipeUI.renderLibrary({compact:true})
  if(productRoute==='shopping')return renderFoodTabs()+renderShopping(calendarItems,shoppingDraft,mode()==='mobile',mode()==='kiosk')
  if(productRoute==='family')return renderFamilyHome()
  if (isLoadingCalendar) {
    return '<p class="calendar-status">Henter kalender...</p>'
  }

  if (calendarViewMode === 'day') {
    return `
      <div class="day-view">
        ${renderDayCard(calendarCursorDate)}
      </div>
    `
  }

  return `
    <div class="week-scroll">
      <div class="week-grid">

        ${getVisibleWeekDays().map((date) => renderDayCard(date)).join('')}
      </div>
    </div>
  `
}

function renderPersonChips() {
  const people = [{id:'Alle',name:'Alle',color:'#0f172a'},...householdPeople.filter(isActiveHouseholdPerson)]
  return '<div id="person-chipbar" class="person-chipbar" aria-label="Personfilter">' + people.map(person => {
    return '<button class="person-chip '+(activePersonFilter===person.id?'active':'')+'" type="button" data-person-filter="'+escapeHtml(person.id)+'" style="border-color:'+escapeHtml(person.color||'#64748b')+'">'+
      renderPersonAvatar(person,'person-chip-avatar')+'<span>'+escapeHtml(person.name)+'</span>'+
      ''+'</button>'
  }).join('')+'</div>'
}

function renderDayCard(date,full=false) {
  if(mode()==='mobile'&&!full)return renderMobileDay(date)
  const dateIso = toDateIso(date)
  const dayItems = getRenderableCalendarItems().filter(item=>eventOverlapsDate(item,dateIso)&&doesItemMatchPersonFilter(item)).sort((a,b)=>Number(eventInterval(b).multiDay)-Number(eventInterval(a).multiDay))
  const compact=!full&&productRoute==='calendar'&&calendarViewMode==='week'
  const budget=mode()==='kiosk'?(innerHeight<700?2:4):6
  const visible=compact?compactDay(dayItems,budget):{items:dayItems,hidden:0}
  const meals=productRoute==='today'?[]:mealsOn(calendarItems,dateIso),shownMeals=compact?meals.slice(0,1):meals
  const hidden=visible.hidden+meals.length-shownMeals.length
  const sections = [
    { key: 'Aktivitet', label: 'Aktiviteter' },
    { key: 'Fritidsinteresse', label: mode()==='kiosk'?'Fritid':'Fritidsinteresser' },
    { key: 'Opgave', label: 'Opgaver' },
  ]
  if (calendarViewMode === 'day' && mode() === 'mobile') sections.sort((a,b) => Number(b.key==='Opgave')-Number(a.key==='Opgave'))

  return `
    <article class="day-card ${[0,6].includes(date.getDay())?'is-weekend':''} ${dateIso === toDateIso(new Date()) ? 'is-today' : ''}" data-day="${dateIso}">
      <header class="day-card-header">
        <strong>${escapeHtml(formatWeekday(date))}</strong>
        <span>${escapeHtml(formatShortDate(date))}${dateIso === toDateIso(new Date()) ? ' · I dag' : ''}</span>

      </header>

      <div class="day-sections">
        ${sections.map((section) => {
          const items = visible.items.filter((item) => getCalendarSection(getCalendarValue(item, 'type')) === section.key)
          if (!items.length) return ''

          return `
            <section class="calendar-day-section">
              <h3>${section.label}</h3>
              <div class="calendar-items">
                ${section.key==='Opgave'?items.map(renderCompactTask).join(''):items.map(item=>compact?renderWeekItem(item,dateIso):renderCalendarItemCard(item,dateIso)).join('')}
              </div>
            </section>
          `
        }).join('') || (meals.length?'':'<p class="empty-section empty-day">'+'Ingen planer'+'</p>')}
        ${hidden?'<button class="day-overflow" data-day-detail="'+dateIso+'">+ '+hidden+' flere</button>':''}
        ${compactMeals(shownMeals)}
      </div>
    </article>
  `
}

function renderWeekItem(item,day){if(eventInterval(item).multiDay)return renderDailyIntervalItem(item,day,true);return '<button class="compact-activity" data-calendar-item="'+escapeHtml(item.id)+'" style="--item-color:'+escapeHtml(getCalendarItemColor(item))+'"><strong>'+renderCalendarItemIcon(item)+escapeHtml(getCalendarItemTitle(item))+'</strong><span class="compact-activity-meta"><time>'+escapeHtml(item.time||'Heldag')+'</time><span>'+escapeHtml(getCalendarItemPeople(item).join(', '))+'</span>'+(sourceLabel(item)?'<small>'+escapeHtml(sourceLabel(item))+'</small>':'')+'</span></button>'}
function renderDailyIntervalItem(item,day,compact=false){
 const title=getCalendarItemTitle(item),people=getCalendarItemPeople(item).join(', '),range=eventDisplayRange(item),label=eventDayLabel(item,day,{compact})
 return '<button class="compact-activity calendar-multiday" data-calendar-item="'+escapeHtml(item.id)+'" data-event-state="'+eventDayState(item,day)+'" aria-label="'+escapeHtml(title+' · '+range+' · '+people)+'" title="'+escapeHtml(range+' · '+people+(sourceLabel(item)?' · '+sourceLabel(item):''))+'" style="--item-color:'+escapeHtml(getCalendarItemColor(item))+'"><strong>'+renderCalendarItemIcon(item)+escapeHtml(title)+'</strong>'+(!compact?'<span class="event-range">'+escapeHtml(eventDateRange(item)+' · '+people)+'</span>':'')+'<span class="compact-activity-meta event-day-label">'+escapeHtml(label)+'</span></button>'
}
function renderCompactTask(item){return compactTask(item,{people:getCalendarItemPeople(item).join(', '),done:taskComplete(item,householdPeople,rewardState,activePersonFilter),reward:rewardRule(item)})}
function openDayDetail(date){detailRoot.innerHTML='<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="day-detail-title"><section class="calendar-modal full-day-detail"><header class="modal-header"><h2 id="day-detail-title">'+escapeHtml(formatDayHeaderDate(parseDateIso(date)))+'</h2><button data-day-close aria-label="Luk">×</button></header>'+renderDayCard(parseDateIso(date),true)+'</section></div>';detailRoot.querySelector('[data-day-close]').onclick=()=>{detailRoot.innerHTML=''};bindCalendarSurface();bindPlanningSurface()}
function renderCalendarItemCard(item,day=toDateIso(calendarCursorDate)) {
  if(managedTask(item))return rewardsUI.taskCard(item,activePersonFilter)
  if(eventInterval(item).multiDay)return renderDailyIntervalItem(item,day)
  if(mode()==='mobile')return renderMobileAgendaItem(item,day)
  const id = item.id
  const type = getCalendarSection(getCalendarValue(item, 'type'))
  const done = Boolean(getCalendarValue(item, 'done'))
  const person = getCalendarItemPeople(item).join(', ') || 'Alle'
  const location = getCalendarValue(item, 'location')
  const note = getCalendarValue(item, 'note')
  const title = getCalendarItemTitle(item)
  const itemIcon = renderCalendarItemIcon(item)
  const timeLabel = getCalendarValue(item, 'time') || 'Heldag'
  const repeatMeta = renderCalendarRepeatMeta(item)
  const iconColumn = itemIcon
    ? `<div class="calendar-item-icon-column">${itemIcon}</div>`
    : ''
  const doneControl = type === 'Opgave' && !imported(item)
    ? `
      <label class="done-toggle">
        <input
          type="checkbox"
          data-calendar-toggle="${escapeHtml(id)}"
          ${done ? 'checked' : ''}
        />
        <span>${done ? 'Udført' : 'Markér udført'}</span>
      </label>
    `
    : ''

  return `
    <article
      class="calendar-item ${itemIcon ? 'has-icon' : ''} ${done ? 'is-done' : ''}"
      data-calendar-item="${escapeHtml(id)}" tabindex="0" role="button" aria-label="${escapeHtml(title+' · '+eventDisplayRange(item))}"
      style="border-left-color:${escapeHtml(getCalendarItemColor(item))}"
    >
      <div class="calendar-item-layout">
        ${iconColumn}
        <div class="calendar-item-content">
          <div class="calendar-item-title-row">
            <strong>${escapeHtml(title)}</strong>
            ${sourceLabel(item) ? `<span class="calendar-source-badge">${sourceLabel(item)}</span>` : ''}
            ${itemIcon ? '' : `<span class="calendar-time-badge">${escapeHtml(timeLabel)}</span>`}
          </div>
          ${itemIcon ? `
            <p class="calendar-item-meta">
              <span>${escapeHtml(timeLabel)}</span>
              <span>${escapeHtml(person)}</span>
              ${repeatMeta}
            </p>
          ` : `<p class="calendar-person">${escapeHtml(person)}${repeatMeta}</p>`}

          ${(location || note) ? `
            <div class="calendar-item-footer">
              ${location ? `<p class="calendar-note">${escapeHtml(location)}</p>` : ''}
              ${note ? `<p class="calendar-note">${escapeHtml(note)}</p>` : ''}
            </div>
          ` : ''}
          ${doneControl}
        </div>
      </div>
    </article>
  `
}

function renderCalendarItemIcon(item) {
  if (getCalendarValue(item, 'type') === 'Opgave') return '<span class="task-emoji" aria-hidden="true">' + taskEmoji(getCalendarItemTitle(item)) + '</span>'
  if (isBirthdayItem(item)) {
    return '<span class="calendar-item-icon calendar-birthday-flag" aria-label="Fødselsdag" title="Fødselsdag"></span>'
  }

  if (isMilestoneItem(item)) {
    return '<span class="calendar-item-icon calendar-milestone-star" aria-label="Mærkedag" title="Mærkedag"></span>'
  }

  return ''
}

function renderCalendarRepeatMeta(item) {
  const labels = []

  if (!imported(item) && (Boolean(getCalendarValue(item, 'repeatWeekly')) || item.isRepeatOccurrence)) {
    labels.push('↻ uge')
  }

  if (!imported(item) && getCalendarValue(item, 'overrideOf')) {
    labels.push('tilpasset')
  }

  return labels.map((label) => `<span class="calendar-repeat-label">${escapeHtml(label)}</span>`).join('')
}

function getCalendarItemTitle(item) { return displayTitle(item) }

function renderCalendarModal() {
  if (!isCalendarModalOpen) {
    return ''
  }

  const item = getEditingCalendarItem()
  const base = item ? baseFor(editingRowsSnapshot, item) : null
  const readOnly = imported(item) || item?.isVirtualMilestone || (managedTask(item)&&!rewardsUI.adult)
  const mode = readOnly ? 'Kalenderaftale' : item ? 'Rediger aftale' : 'Ny aftale'
  const submitText = item ? 'Gem ændringer' : 'Opret aftale'
  const values = {
    title: getCalendarValue(item || {}, 'title'),
    date: (item?.isYearlyOccurrence ? getCalendarValue(base || item, 'date') : getCalendarValue(item || {}, 'date')) || getDefaultCalendarItemDate(),
    time: getCalendarValue(item || {}, 'time'),
    people: item && itemPersonIds(item, householdPeople).length ? [...itemPersonIds(item, householdPeople), ...(item.data?.unresolvedPeople || [])] : getCalendarItemPeople(item || {}),
    type: normalizeTypeValue(getCalendarValue(item || {}, 'type') || newCalendarType),
    durationMin: getCalendarValue(item || {}, 'durationMin'),
    location: getCalendarValue(item || {}, 'location'),
    note: getCalendarValue(item || {}, 'note'),
    done: Boolean(getCalendarValue(item || {}, 'done')),
    repeatWeekly: Boolean(getCalendarValue(base || item || {}, 'repeatWeekly')),
    weekdays: Boolean(getCalendarValue(item || {}, 'weekdays')),
    birthYear: getCalendarValue(item || {}, 'birthYear'),
  }
  const interval=item?eventInterval(item):{endDate:values.date,endTime:'',allDay:false}
  const isBirthday = values.type === 'Fødselsdag'
  const isTask = values.type === 'Opgave'
  const isMilestone = values.type === 'Mærkedag'
  const hasRepeatScope = Boolean(item && isRepeatContextItem(item))
  const canUseWeekdays = !item && !isBirthday && !isMilestone

  return `
    <div id="calendar-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calendar-modal-title">
      <div class="calendar-modal">
        <header class="modal-header">
          <h2 id="calendar-modal-title">${mode}</h2>
          <button id="calendar-modal-close" class="icon-button" type="button" aria-label="Luk">×</button>
        </header>

        <form id="calendar-modal-form">
          ${readOnly ? '<p class="source-notice">' + (managedTask(item)&&!rewardsUI.adult?'Belønningsopgaver redigeres af en voksen.':item.isVirtualMilestone ? 'Automatisk mærkedag fra kalenderens traditionsliste.' : 'Importeret fra ' + sourceLabel(item) + '. Redigér aftalen i kildekalenderen; ændringer kommer med ved næste import.') + '</p>' : ''}
          ${item?.isYearlyOccurrence ? '<p class="source-notice">Ændringer gælder fødselsdagen i alle år. Datoen her er den oprindelige dato.</p>' : ''}
          <fieldset class="calendar-fields" ${readOnly ? 'disabled' : ''}>
          <div class="form-grid">
            <div class="full">
              <label for="calendar-title">Titel</label>
              <input id="calendar-title" name="title" type="text" value="${escapeHtml(values.title)}" maxlength="1000" required />
              <datalist id="task-suggestions">${[...new Set([...taskSuggestions, ...calendarItems.filter(row => row.type === 'Opgave').map(row => row.title)])].map(title => '<option value="' + escapeHtml(title) + '"></option>').join('')}</datalist>
            </div>

            <div>
              <label for="calendar-date">Startdato</label>
              <input id="calendar-date" name="date" type="date" value="${escapeHtml(values.date)}" required />
            </div>

            <div>
              <label for="calendar-time">Starttid</label>
              <input id="calendar-time" name="time" type="time" value="${escapeHtml(values.time)}" />
            </div>

            <div class="interval-field">
              <label for="calendar-end-date">Slutdato</label>
              <input id="calendar-end-date" name="endDate" type="date" value="${escapeHtml(interval.endDate)}" required />
            </div>
            <div class="interval-field">
              <label for="calendar-end-time">Sluttid</label>
              <input id="calendar-end-time" name="endTime" type="time" value="${escapeHtml(interval.endTime)}" />
            </div>
            <label class="interval-field full interval-all-day"><input id="calendar-all-day" name="allDay" type="checkbox" ${interval.allDay?'checked':''}> Heldag</label>
            <div class="full">
              <label>Personer</label>
              <div class="calendar-person-pills">
                ${renderCalendarPersonPills(values.people)}
              </div>
            </div>

            <div>
              <label for="calendar-type">Type</label>
              <select id="calendar-type" name="type">
                ${renderTypeOption('Aktivitet', values.type)}
                ${renderTypeOption('Opgave', values.type)}
                ${renderTypeOption('Fritidsinteresse', values.type)}
                ${renderTypeOption('Fødselsdag', values.type)}
                ${renderTypeOption('Mærkedag', values.type)}
              </select>
            </div>

            <div>
              <label for="calendar-duration">Varighed</label>
              <input id="calendar-duration" name="durationMin" type="number" min="0" step="5" value="${escapeHtml(values.durationMin)}" />
            </div>

            <div class="full">
              <label for="calendar-location">Lokation</label>
              <input id="calendar-location" name="location" type="text" value="${escapeHtml(values.location)}" />
            </div>

            <div id="birthday-fields" class="full ${isBirthday ? '' : 'hidden'}">
              <label for="calendar-birth-year">Fødselsår</label>
              <input id="calendar-birth-year" name="birthYear" type="number" min="1900" max="2100" step="1" value="${escapeHtml(values.birthYear)}" />
            </div>

            <div class="full">
              <label for="calendar-note">Note</label>
              <textarea id="calendar-note" name="note">${escapeHtml(values.note)}</textarea>
            </div>

            <div id="calendar-options" class="full repeat-options ${isBirthday || readOnly ? 'hidden' : ''}">
              <label id="repeat-weekly-option" class="checkbox-label ${isBirthday ? 'hidden' : ''}">
                <input name="repeatWeekly" type="checkbox" ${values.repeatWeekly && !isBirthday ? 'checked' : ''} ${isBirthday ? 'disabled' : ''} />
                Gentag hver uge
              </label>
              <label id="weekdays-option" class="checkbox-label ${canUseWeekdays ? '' : 'hidden'}">
                <input name="weekdays" type="checkbox" ${values.weekdays && canUseWeekdays ? 'checked' : ''} ${canUseWeekdays ? '' : 'disabled'} />
                Alle hverdage
              </label>
              <label id="done-option" class="checkbox-label ${isTask ? '' : 'hidden'}">
                <input name="done" type="checkbox" ${values.done && isTask ? 'checked' : ''} ${isTask ? '' : 'disabled'} />
                Marker som udført
              </label>
            </div>
            ${hasRepeatScope ? `
              <div class="full repeat-scope-options">
                <label>Ændringen gælder for</label>
                <div class="repeat-scope-row">
                  <label class="checkbox-label"><input type="radio" name="repeatScope" value="one" checked /> Kun denne</label>
                  <label class="checkbox-label"><input type="radio" name="repeatScope" value="future" /> Denne og frem</label>
                  <label class="checkbox-label"><input type="radio" name="repeatScope" value="series" /> Hele serien</label>
                </div>
                <p id="calendar-scope-help" class="source-notice"></p>
              </div>
            ` : ''}
          </div>

          </fieldset>
          <p id="calendar-editor-message" class="message" role="status"></p>
          <footer class="modal-actions">
            ${item && !readOnly ? '<button id="calendar-modal-delete" class="danger-button" type="button">Slet</button>' : ''}
            <button id="calendar-modal-cancel" type="button">Annuller</button>
            ${readOnly ? '' : `<button type="submit">${submitText}</button>`}
          </footer>
        </form>
      </div>
    </div>
  `
}

function renderSettingsModal() {
  if (!isSettingsModalOpen) {
    return ''
  }

  return `
    <div id="settings-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div class="settings-modal">
        <header class="modal-header">
          <h2 id="settings-modal-title">Indstillinger</h2>
          <button id="settings-modal-close" class="icon-button" type="button" aria-label="Luk">×</button>
        </header>

        ${renderSettingsNavigation()}
        ${renderOtherSettings()}
        <section class="settings-block" data-settings-panel="people" ${settingsTab==='people'?'':'hidden'}>
          <div class="settings-block-header">
            <div>
              <h3>Personer</h3>
              <p>Opdater navne, farver og avatarer</p>
            </div>
          </div>

          ${renderSettingsPeopleList()}

          <form id="people-settings-form" class="people-settings-form">
            <h3>+ Tilf&oslash;j person</h3>
            <div class="settings-add-person-grid">
              <div class="person-avatar-preview" data-avatar-preview="new">
                ${renderPersonAvatar({ name: '', color: '#64748b', avatar_url: '' }, 'person-settings-avatar')}
              </div>
              <input type="hidden" name="avatar_url" value="" data-person-avatar-value="new" />
              <div>
                <label for="person-name">Navn</label>
                <input id="person-name" name="name" type="text" data-person-name-input="new" />
              </div>
              <div>
                <label for="person-role">Rolle</label>
                <select id="person-role" name="role">
                  ${renderRoleOption('voksen', 'barn')}
                  ${renderRoleOption('barn', 'barn')}
                  ${renderRoleOption('andet', 'barn')}
                </select>
              </div>
              <div>
                <label for="person-color">Farve</label>
                <input id="person-color" name="color" type="color" value="#64748b" data-person-color-input="new" />
              </div>
              <div>
                <label for="person-avatar-file">Avatar</label>
                <input id="person-avatar-file" name="avatar_file" type="file" accept="image/png,image/jpeg,image/webp" data-person-avatar-file="new" />
              </div>
              <span class="person-settings-swatch" style="background:#64748b" data-person-color-swatch="new"></span>
            </div>
            <label class="reward-setting"><input id="person-reward-enabled" name="reward_enabled" type="checkbox" checked />Deltager i belønningssystemet</label>
            <p class="hint">Avatar kan tilføjes senere.</p>
            <footer class="modal-actions">
              <button type="submit" ${isCreatingPerson ? 'disabled' : ''}>${isCreatingPerson ? 'Gemmer...' : 'Gem personer'}</button>
            </footer>
          </form>

          <p class="message">${escapeHtml(settingsMessage)}</p>
        </section>

        <section class="settings-block" data-settings-panel="feeds" ${settingsTab==='feeds'?'':'hidden'}>
          <div class="settings-block-header">
            <div>
              <h3>Kalender-import</h3>
              <p>Aktive kalendere synkroniseres automatisk hvert 5. minut.</p>
            </div>
            <button id="add-calendar-feed-button" class="btn small" type="button" ${canManageFeeds() ? '' : 'disabled'}>+ Tilf&oslash;j feed</button>
          </div>

          ${renderCalendarFeedsList()}
          ${renderCalendarFeedForm()}
          <button type="button" id="hidden-imports-open">Skjulte importerede aftaler</button>
          ${renderHiddenImports()}
          ${calendarImportMessage ? `<p class="message subtle-message">${escapeHtml(calendarImportMessage)}</p>` : ''}
        </section>
      </div>
    </div>
  `
}

function renderSettingsPeopleList() {
  if (isLoadingPeople) {
    return '<p class="empty-state">Henter personer...</p>'
  }

  if (!householdPeople.length) {
    return '<p class="empty-state">Ingen personer endnu. Opret den første person herunder.</p>'
  }

  return `
    <div class="people-settings-list">
      ${householdPeople.map((person) => renderPersonSettingsRow(person)).join('')}
    </div>
  `
}

function renderCalendarFeedsList() {
  if (!canManageFeeds()) return '<p>Kun familiens ejer og administratorer kan administrere kalenderfeeds.</p>'
  if (isLoadingCalendarFeeds) {
    return '<p class="empty-state">Henter feeds...</p>'
  }

  if (!calendarFeeds.length) {
    return '<p class="empty-state">Ingen feeds endnu.</p>'
  }

  return `
    <div class="calendar-feed-list">
      ${calendarFeeds.map((feed) => renderCalendarFeedRow(feed)).join('')}
    </div>
  `
}

function renderCalendarFeedRow(feed) {
  const name = feed.name || 'Uden navn'
  const assignedPerson = feedPerson(feed, householdPeople)?.name || feed.assigned_person_name || 'Ingen'
  const source = getCalendarFeedSourceLabel(feed.source)
  const isActive = feed.is_active !== false
  const syncStatus = getCalendarFeedSyncStatus(feed)
  const feedUrl = redactFeedUrl(feed.feed_url)
  const isImporting = String(importingCalendarFeedId || '') === String(feed.id)
  const importStatus = calendarFeedImportMessages[String(feed.id)] || null

  return `
    <article class="calendar-feed-row ${isActive ? '' : 'inactive'}">
      <div class="calendar-feed-main">
        <div class="calendar-feed-title-row">
          <h4>${escapeHtml(name)}</h4>
          <span class="calendar-feed-badge">${escapeHtml(source)}</span>
          <span class="calendar-feed-badge ${isActive ? 'active' : 'inactive'}">${isActive ? 'Aktiv' : 'Inaktiv'}</span>
        </div>
        <p class="calendar-feed-meta">Person: ${escapeHtml(assignedPerson)}</p>
        <p class="calendar-feed-url" title="${escapeHtml(feedUrl)}">${escapeHtml(feedUrl)}</p>
        <p class="calendar-feed-status" data-feed-status="${escapeHtml(feed.id)}">${escapeHtml(syncStatus)}</p>
        ${importStatus ? `
          <p class="calendar-feed-status ${escapeHtml(importStatus.type || '')}">
            <span>${escapeHtml(importStatus.text)}</span>
            ${importStatus.dateText ? `<span>${escapeHtml(importStatus.dateText)}</span>` : ''}
            ${importStatus.feedId ? `<button class="calendar-feed-next-button" type="button" data-go-to-imported-calendar-feed="${escapeHtml(importStatus.feedId)}">G&aring; til n&aelig;ste aftale</button>` : ''}
          </p>
        ` : ''}
      </div>
      <div class="calendar-feed-actions">
        <button type="button" data-copy-calendar-feed="${escapeHtml(String(feed.id))}">Kopiér link</button>
        <button type="button" data-edit-calendar-feed="${escapeHtml(String(feed.id))}">Rediger</button>
        <button type="button" data-import-calendar-feed="${escapeHtml(String(feed.id))}" ${isImporting || !isActive ? 'disabled' : ''}>${isImporting ? 'Henter...' : 'Hent nu'}</button>
        <button class="danger-button" type="button" data-delete-calendar-feed="${escapeHtml(String(feed.id))}">Slet</button>
      </div>
    </article>
  `
}

function renderCalendarFeedForm() {
  if (!editingCalendarFeedId) {
    return ''
  }

  const isEditing = editingCalendarFeedId !== 'new'

  return `
    <form id="calendar-feed-form" class="calendar-feed-form">
      <h3>${isEditing ? 'Rediger feed' : '+ Tilf&oslash;j feed'}</h3>
      <div class="calendar-feed-form-grid">
        <div>
          <label for="calendar-feed-source">Kilde</label>
          <select id="calendar-feed-source" name="source" data-calendar-feed-field>
            ${renderCalendarFeedSourceOption('aula', calendarFeedDraft.source)}
            ${renderCalendarFeedSourceOption('google', calendarFeedDraft.source)}
            ${renderCalendarFeedSourceOption('ics', calendarFeedDraft.source)}
          </select>
        </div>
        <div>
          <label for="calendar-feed-person">Tilknyttet person</label>
          <select id="calendar-feed-person" name="assigned_person_id" data-calendar-feed-field>
            ${renderCalendarFeedPersonOptions(calendarFeedDraft.assigned_person_id)}
          </select>
        </div>
        <label class="calendar-feed-active">
          <input name="is_active" type="checkbox" ${calendarFeedDraft.is_active ? 'checked' : ''} data-calendar-feed-field />
          Aktiv
        </label>
        <div class="calendar-feed-url-field">
          <label for="calendar-feed-url">Feed URL</label>
          <input id="calendar-feed-url" name="feed_url" type="url" placeholder="https://" value="${escapeHtml(calendarFeedDraft.feed_url)}" data-calendar-feed-field required />
        </div>
      </div>

      <p id="calendar-import-help" class="calendar-import-help">${escapeHtml(getCalendarImportHelpText(calendarFeedDraft.source))}</p>

      <footer class="modal-actions">
        <button id="calendar-feed-cancel" type="button">Annuller</button>
        <button type="submit" ${isSavingCalendarFeed ? 'disabled' : ''}>${isSavingCalendarFeed ? 'Gemmer...' : 'Gem feed'}</button>
      </footer>
    </form>
  `
}

function renderCalendarFeedSourceOption(source, currentSource) {
  return `
    <option value="${escapeHtml(source)}" ${source === currentSource ? 'selected' : ''}>
      ${escapeHtml(getCalendarFeedSourceLabel(source))}
    </option>
  `
}

function renderCalendarFeedPersonOptions(currentPerson) {
  const options = [{ id: '', name: 'Ingen' }, { id: 'Alle', name: 'Alle' }, ...householdPeople.filter(isActiveHouseholdPerson)]
  if (currentPerson && !options.some(person => person.id === currentPerson)) options.push({ id: currentPerson, name: currentPerson })
  return options.map(person => '<option value="' + escapeHtml(person.id) + '" ' + (person.id === currentPerson ? 'selected' : '') + '>' + escapeHtml(person.name) + '</option>').join('')
}

function createEmptyCalendarFeedDraft() { return { source: 'aula', feed_url: '', assigned_person_id: '', assigned_person_name: '', is_active: true } }

function createCalendarFeedDraft(feed) {
  return { source: normalizeCalendarFeedSource(feed.source), feed_url: String(feed.feed_url || ''),
    assigned_person_id: feedPerson(feed, householdPeople)?.id || feed.assigned_person_name || '',
    assigned_person_name: feed.assigned_person_name || '', is_active: feed.is_active !== false }
}

function getCalendarFeedDraftValues() {
  const source = normalizeCalendarFeedSource(calendarFeedDraft.source)
  const selected = calendarFeedDraft.assigned_person_id
  const person = findPerson(selected, householdPeople)
  const name = person?.name || selected || ''
  return { source, name: buildCalendarFeedName(source, name), feed_url: normalizeFeedUrl(calendarFeedDraft.feed_url),
    assigned_person_id: person?.id || null, assigned_person_name: name || null, is_active: !!calendarFeedDraft.is_active }
}

function buildCalendarFeedName(source, assignedPersonName) {
  const sourceLabel = getCalendarFeedSourceLabel(source)
  const personName = String(assignedPersonName || '').trim()

  return `${sourceLabel} - ${personName || 'Familie'}`
}

function normalizeCalendarFeedSource(source) {
  const value = String(source || '').trim().toLowerCase()

  if (['aula', 'google', 'ics'].includes(value)) {
    return value
  }

  return 'aula'
}

function getCalendarFeedSourceLabel(source) {
  const labels = {
    aula: 'Aula',
    google: 'Google',
    ics: 'ICS',
  }

  return labels[normalizeCalendarFeedSource(source)]
}

function getCalendarFeedSyncStatus(feed) { return feedSyncStatus(feed) }

function setCalendarFeedImportMessage(feedId, text, type = 'info', details = {}) {
  calendarFeedImportMessages = {
    ...calendarFeedImportMessages,
    [String(feedId)]: { text, type, ...details },
  }
}

async function getEdgeFunctionErrorMessage(error) {
  const context = error?.context

  if (context && typeof context.clone === 'function') {
    try {
      const body = await context.clone().json()
      const message = body?.error || body?.message || body?.details

      if (message) {
        return formatErrorMessage(message)
      }
    } catch (_) {
      try {
        const text = await context.clone().text()

        if (text) {
          return text
        }
      } catch (_) {
        // Fall back to the generic client error below.
      }
    }
  }

  return formatErrorMessage(error?.message || error)
}

function formatErrorMessage(value) {
  if (!value) {
    return 'Ukendt fejl'
  }

  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Error) {
    return value.message || 'Ukendt fejl'
  }

  if (typeof value === 'object') {
    const message = value.error || value.message || value.details || value.hint || value.statusText

    if (message && message !== value) {
      return formatErrorMessage(message)
    }

    try {
      return JSON.stringify(value)
    } catch (_) {
      return 'Ukendt fejl'
    }
  }

  return String(value)
}

function getCalendarImportSuccessMessage(data) {
  const importedCount = data?.importedCount ?? data?.imported ?? data?.count ?? data?.items?.length ?? data?.events?.length

  if (Number.isFinite(Number(importedCount))) {
    return `Importerede ${Number(importedCount)} aftaler. Gå til relevant uge manuelt.`
  }

  const preview = data?.preview || data?.previewText || data?.text || data?.raw

  if (typeof preview === 'string' && preview.length) {
    return `Feed hentet OK. Preview: ${preview.length} tegn. Gå til relevant uge manuelt.`
  }

  if (Number.isFinite(Number(data?.previewLength))) {
    return `Feed hentet OK. Preview: ${Number(data.previewLength)} tegn. Gå til relevant uge manuelt.`
  }

  if (data && Object.keys(data).length) {
    return 'Feed hentet OK. Preview modtaget. Gå til relevant uge manuelt.'
  }

  return 'Feed hentet OK. Gå til relevant uge manuelt.'
}

function getCalendarImportResult(feed, data) {
  const message = getCalendarImportStatusText(data)
  const summary = getImportedCalendarItemsSummary(feed)

  if (!summary.count) {
    return {
      text: `${message}, men ingen matchende items blev fundet i appens load. Tjek household/source/feed-id.`,
      dateText: '',
      feedId: '',
    }
  }

  return {
    text: message,
    dateText: `Datoer: ${formatCalendarImportDateRange(summary.firstDate, summary.lastDate)}`,
    feedId: String(feed.id),
  }
}

function getCalendarImportStatusText(data) {
  const message = String(data?.message || '').trim()

  if (message) {
    return message
  }

  const importedCount = getImportedCalendarCount(data)

  if (Number.isFinite(importedCount)) {
    return `Importerede ${importedCount} aftaler`
  }

  return getCalendarImportSuccessMessage(data)
}

function getImportedCalendarCount(data) {
  const importedCount = data?.importedCount ?? data?.imported ?? data?.count ?? data?.items?.length ?? data?.events?.length
  const number = Number(importedCount)

  return Number.isFinite(number) ? number : NaN
}

function getImportedCalendarItemsSummary(feed) {
  const dates = getImportedCalendarItemsForFeed(feed)
    .map((item) => toDateString(getCalendarValue(item, 'date')))
    .filter(Boolean)
    .sort()

  if (!dates.length) {
    return {
      count: 0,
      firstDate: '',
      lastDate: '',
      nextDate: '',
    }
  }

  const today = toDateIso(new Date())

  return {
    count: dates.length,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    nextDate: dates.find((date) => date >= today) || dates[0],
  }
}

function getImportedCalendarItemsForFeed(feed) {
  const source = normalizeCalendarFeedSource(feed.source)
  const feedId = String(feed.id)

  return calendarItems.filter((item) => {
    const itemSource = normalizeCalendarFeedSource(getCalendarValue(item, 'source'))
    const itemFeedId = getCalendarItemImportFeedId(item)

    return itemSource === source && itemFeedId === feedId
  })
}

function getCalendarItemImportFeedId(item) { return feedIdOf(item) }

function formatCalendarImportDateRange(firstDate, lastDate) {
  if (!firstDate || !lastDate) {
    return ''
  }

  if (firstDate === lastDate) {
    return formatCalendarImportDate(firstDate)
  }

  return `${formatCalendarImportDate(firstDate)}–${formatCalendarImportDate(lastDate)}`
}

function formatCalendarImportDate(dateIso) {
  const date = parseDateIso(dateIso)

  if (!date) {
    return dateIso
  }

  return new Intl.DateTimeFormat('da-DK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function renderPersonSettingsRow(person, { isNew = false } = {}) {
  const rowId = isNew ? 'new' : String(person.id)
  const prefix = isNew ? 'new' : `person-${rowId}`
  const name = person.name || ''
  const role = mapPersonRoleToUi(person.role)
  const color = person.color || '#64748b'
  const avatar = avatarDisplayUrl(person)

  return `
    <fieldset ${isCreatingPerson ? 'disabled' : ''} class="person-settings-row ${person.is_active===false?'is-archived':''}" data-person-row="${escapeHtml(rowId)}">
      <div class="person-avatar-preview" data-avatar-preview="${escapeHtml(rowId)}">
        ${renderPersonAvatar(person, 'person-settings-avatar')}
      </div>
      <input type="hidden" name="${prefix}-avatar" value="${escapeHtml(person.avatar_url || '')}" data-person-avatar-value="${escapeHtml(rowId)}" />
      <div>
        <label for="${prefix}-name">Navn</label>
        <input id="${prefix}-name" name="${prefix}-name" type="text" value="${escapeHtml(name)}" data-person-name-input="${escapeHtml(rowId)}" ${isNew ? '' : 'required'} />
      </div>
      <div>
        <label for="${prefix}-role">Rolle</label>
        <select id="${prefix}-role" name="${prefix}-role">
          ${renderRoleOption('voksen', role)}
          ${renderRoleOption('barn', role)}
          ${renderRoleOption('andet', role)}
        </select>
      </div>
      <div>
        <label for="${prefix}-avatar-file">Avatar</label>
        <input id="${prefix}-avatar-file" name="${prefix}-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" data-person-avatar-file="${escapeHtml(rowId)}" />
      </div>
      <div>
        <label for="${prefix}-color">Farve</label>
        <input id="${prefix}-color" name="${prefix}-color" type="color" value="${escapeHtml(color)}" data-person-color-input="${escapeHtml(rowId)}" />
      </div>
      <label class="reward-setting"><input type="checkbox" id="${prefix}-reward-enabled" ${rewardEnabled(person) ? 'checked' : ''} />Deltager i belønningssystemet</label>
      <span class="person-settings-swatch" style="background:${escapeHtml(color)}" data-person-color-swatch="${escapeHtml(rowId)}"></span>
      ${isNew ? '' : `<div class="person-row-actions"><button class="btn small" type="button" data-save-person="${escapeHtml(rowId)}">Gem</button><button type="button" data-archive-person="${escapeHtml(rowId)}">${person.is_active===false?'Gendan':'Arkivér'}</button></div>`}
    </fieldset>
  `
}

function renderRoleOption(role, currentRole) {
  const roleValue = mapPersonRoleToUi(role)
  const currentValue = mapPersonRoleToUi(currentRole)

  return `
    <option value="${escapeHtml(roleValue)}" ${roleValue === currentValue ? 'selected' : ''}>
      ${escapeHtml(getPersonRoleLabel(roleValue))}
    </option>
  `
}

function mapPersonRoleToUi(role) {
  const normalizedRole = String(role || '').trim().toLowerCase()
  const roles = {
    adult: 'voksen',
    child: 'barn',
    other: 'andet',
    voksen: 'voksen',
    barn: 'barn',
    andet: 'andet',
  }

  return roles[normalizedRole] || 'andet'
}

function mapPersonRoleForDb(role) {
  const uiRole = mapPersonRoleToUi(role)
  const roles = {
    voksen: 'adult',
    barn: 'child',
    andet: 'other',
  }

  return roles[uiRole] || 'other'
}

function getPersonRoleLabel(role) {
  const labels = {
    voksen: 'Voksen',
    barn: 'Barn',
    andet: 'Andet',
  }

  return labels[mapPersonRoleToUi(role)] || 'Andet'
}

function renderPersonAvatar(person, className) {
  const name = person.name || 'Alle'
  const avatar = avatarDisplayUrl(person)
  const color = person.color || getPersonColor(name)
  const initial = (name.trim()[0] || '?').toUpperCase()

  if (avatar) {
    return `<span class="${className}"><img src="${escapeHtml(avatar)}" alt="" /></span>`
  }

  return `<span class="${className}" style="background:${escapeHtml(color)}22;color:#111827">${escapeHtml(initial)}</span>`
}

async function handleLogin(event) {
  event.preventDefault()
  if (authRequestInFlight) return
  const form = event.target
  const formData = new FormData(form)
  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '')
  const signup = event.submitter?.value === 'signup'
  authRequestInFlight = true
  form.querySelectorAll('button').forEach(button => { button.disabled = true })
  try {
    const { data, error } = signup
      ? await supabase.auth.signUp({ email, password, options:{emailRedirectTo:callback()} })
      : await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (data?.session) await applySession(data.session)
    else { authScreen='login';message = 'Bruger oprettet. Tjek din email for bekræftelse.'; render() }
  } catch (error) { message = 'Login kunne ikke gennemføres: ' + error.message; render() }
  finally { authRequestInFlight = false; form.querySelectorAll('button').forEach(button => { button.disabled = false }) }
}

async function handleLogout() {
  const userId = session?.user.id
  const pending = syncEngine?.state.queue.length || 0
  if (pending && !window.confirm(pending + ' ændringer er ikke synkroniseret. Log ud rydder dem fra denne enhed. Fortsæt?')) return
  syncEngine?.stop(); realtime.stop(); rewardMotion.reset()
  await devices?.detach().catch(()=>{})
  await clearNativeExports({all:true}).catch(()=>{})
  if (userId) await localStore.clearUser(userId)
  clearLocalAuth()
  authScreen='login';sessionStorage.removeItem('familiekalender.recovery');sessionStorage.removeItem('familiekalender.pending-invite');pendingInvite=''
  clearSessionState(); render()
  // Local logout must work without a network; cached household data is already gone.
  void supabase.auth.signOut({scope:'local'}).catch(() => {})
}

async function loadHouseholds() {
  const epoch = sessionEpoch, userId = session?.user.id
  if (!userId || !navigator.onLine) return
  const [result, memberships] = await Promise.all([
    supabase.from('households').select('*').order('created_at').order('id').abortSignal(AbortSignal.timeout(6000)),
    supabase.from('household_members').select('household_id,role').eq('user_id',userId).abortSignal(AbortSignal.timeout(6000)),
  ])
  if (epoch !== sessionEpoch) return
  const error = result.error || memberships.error
  householdsLoadFailed = Boolean(error) && !households.length
  if (error) { message = households.length ? '' : 'Kunne ikke hente familie: ' + error.message; return }
  const roles = new Map((memberships.data || []).map(row => [row.household_id,row.role]))
  households = (result.data || []).map(row => ({...row,memberRole:roles.get(row.id)}))
  await rememberHouseholds()
}

function chooseDefaultHousehold() {
  activeHousehold = households[0] || null
  householdRole = activeHousehold?.memberRole || null
  calendarItems = []
  calendarItemsHouseholdId = null
  householdPeople = []
  householdPeopleHouseholdId = null
  calendarFeeds = []
  calendarFeedsHouseholdId = null
  activePersonFilter = 'Alle'
  calendarCursorDate = new Date()
}

async function handleCreateHousehold(event) {
  event.preventDefault()

  if (isCreatingHousehold) {
    return
  }

  const form = event.target
  const submitButton = form.querySelector('button[type="submit"]')
  const messageElement = document.querySelector('#message')
  const formData = new FormData(form)
  const name = String(formData.get('name')).trim()

  if (!name) {
    return
  }

  const previousIds = new Set(households.map((household) => String(household.id)))

  isCreatingHousehold = true
  submitButton.disabled = true
  submitButton.textContent = 'Opretter...'
  messageElement.textContent = 'Opretter...'

  const { data, error } = await supabase.rpc('create_household', {
    p_name: name,
  })

  isCreatingHousehold = false

  if (error) {
    message = `Kunne ikke oprette familien: ${error.message}`
    render()
    return
  }

  form.reset()
  await loadHouseholds()
  const created = findCreatedHousehold(data, previousIds, name) || households[0]
  if (created) await activateHousehold(created)
  message = ''; render(); await refreshHousehold()
}

async function loadCalendarItems() {
  if (!syncEngine || !navigator.onLine) return
  const engine = syncEngine, id = activeHousehold.id, version = ++calendarLoadVersion, writeGeneration = engine.writeGeneration
  const { data, error } = await readAllRows(() => supabase.from('calendar_items').select('*').eq('household_id',id).order('date').order('time').order('id').abortSignal(AbortSignal.timeout(6000)),
    () => engine === syncEngine && version === calendarLoadVersion)
  if (engine !== syncEngine || version !== calendarLoadVersion) return
  // A request started before our write/ACK cannot replace the newer local baseline.
  if (writeGeneration !== engine.writeGeneration) { if (!engine.running) return loadCalendarItems(); return }
  if (!error && data) { engine.networkFailed = false; await engine.snapshot({items:data}) }
  else if (error) { syncStatus.offline = true; updateCalendarSurface() }
}

async function loadHouseholdPeople() {
  if (!syncEngine || !navigator.onLine) return
  const engine = syncEngine, version = ++peopleLoadVersion
  const { data, error } = await supabase.from('household_people').select('*').eq('household_id',activeHousehold.id).order('sort_order').order('name').abortSignal(AbortSignal.timeout(6000))
  if (error || engine !== syncEngine || version !== peopleLoadVersion) return
  const people = await resolveAvatarUrls(supabase, data || [])
  if (engine !== syncEngine || version !== peopleLoadVersion) return
  householdPeople = people
  await engine.snapshot({people})
}

async function loadCalendarFeeds() {
  if (!syncEngine || !navigator.onLine) return
  const engine = syncEngine, version = ++feedsLoadVersion
  if (!canManageFeeds()) { liveFeedMetadata = []; await engine.snapshot({feeds:[]}); return }
  const { data, error } = await supabase.from('calendar_feeds').select('*').eq('household_id',activeHousehold.id).order('name').abortSignal(AbortSignal.timeout(6000))
  if (error || engine !== syncEngine || version !== feedsLoadVersion) return
  liveFeedMetadata = data || []
  for(const feed of liveFeedMetadata){const status=document.querySelector('[data-feed-status="'+feed.id+'"]');if(status)status.textContent=feedSyncStatus(feed)}
  await engine.snapshot({feeds:liveFeedMetadata})
}

async function handleSaveCalendarItem(event) {
  event.preventDefault()
  if (isCreatingCalendarItem || !activeHousehold) return
  const form = event.target, formData = new FormData(form), editingItem = getEditingCalendarItem()
  if (imported(editingItem) || editingItem?.isVirtualMilestone) return
  const type = normalizeTypeValue(String(formData.get('type') || 'Aktivitet'))
  const scope = String(formData.get('repeatScope') || 'one')
  const dateInput = form.querySelector('#calendar-date')
  const selection = selectPeople(formData.getAll('people'), householdPeople)
  const itemData = {
    title: String(formData.get('title') || '').trim(), date: dateInput.value,
    time: String(formData.get('time') || ''), ...selection, person: selection.people[0],
    type, durationMin: parseOptionalNumber(formData.get('durationMin')),
    location: String(formData.get('location') || '').trim(), note: String(formData.get('note') || '').trim(),
    done: type === 'Opgave' && formData.has('done'),
    repeatWeekly: type !== 'Fødselsdag' && form.querySelector('[name=repeatWeekly]').checked,
    weekdays: !editingItem && !['Fødselsdag','Mærkedag'].includes(type) && formData.has('weekdays'),
    repeatYearly: type === 'Fødselsdag', birthYear: type === 'Fødselsdag' ? String(formData.get('birthYear') || '') : '',
  }
  if(supportsInterval(itemData)){
    Object.assign(itemData,{endDate:String(formData.get('endDate')||itemData.date),endTime:String(formData.get('endTime')||''),allDay:formData.has('allDay'),durationMin:null})
    if(itemData.allDay){itemData.time='';itemData.endTime=''}
    const invalid=validateEventInterval(itemData)
    if(invalid){form.querySelector('#calendar-editor-message').textContent=invalid;return}
  }else Object.assign(itemData,{endDate:null,endTime:null,allDay:null})
  if(type==='Opgave'){
    const fields=document.querySelector('#task-reward-fields')
    if(fields&&!fields.disabled){itemData.rewardMode=formData.get('rewardMode')||'none';itemData.starValue=itemData.rewardMode==='stars'?Number(formData.get('starValue')):0;itemData.requiresApproval=formData.has('requiresApproval');itemData.bonusPool=itemData.rewardMode==='stars'&&formData.has('bonusPool')}
    else if(editingItem)Object.assign(itemData,{rewardMode:calendarValue(editingItem,'rewardMode')||'none',starValue:calendarValue(editingItem,'starValue')||0,requiresApproval:!!calendarValue(editingItem,'requiresApproval'),bonusPool:!!calendarValue(editingItem,'bonusPool')})
    if((itemData.rewardMode&&itemData.rewardMode!=='none')||itemData.requiresApproval)itemData.done=Boolean(editingItem?.done)
  }
  if (!itemData.title || !itemData.date) return
  isCreatingCalendarItem = true
  const button = form.querySelector('button[type=submit]'); button.disabled = true
  const result = await runCalendarMutation(() => editingItem
    ? planEdit(editingRowsSnapshot, editingItem, itemData, scope)
    : planCreate(itemData), {action: editingItem ? 'edit' : 'create', entityId: editingItem?.id})
  isCreatingCalendarItem = false
  if (result.error) {
    button.disabled = false
    form.querySelector('#calendar-editor-message').textContent = result.error.message
    return
  }
  isCalendarModalOpen = false; editingCalendarItemId = null; editingCalendarSnapshot = null; editingRowsSnapshot = []
  message = editingItem ? 'Kalender-item opdateret.' : 'Kalender-item oprettet.'
  await loadCalendarItems()
  render({ preserveDialogs: true })
}
async function runCalendarMutation(makePlan, options = {}) {
  try {
    const plan = makePlan()
    if (!syncEngine) throw new Error('Kalenderen er endnu ikke klar.')
    return await syncEngine.enqueue({
      p_expected: plan.expected, p_delete_ids: plan.deleteIds,
      p_upserts: plan.upserts.map(({id,values}) => ({id,...calendarPayload(values,householdPeople)})),
    }, options)
  } catch (error) { updateCalendarSurface(); return { error } }
}

async function toggleCalendarItemDone(itemId, done) {
  const item = findRenderableCalendarItem(itemId)
  if (!item || imported(item)) return
  rewardMotion.taskCheck(item.id,done?'completed':'open')
  const { error } = await runCalendarMutation(() => planEdit(calendarItems,item,{...itemValues(item),done},'one'),
    {action:'toggle_done',entityId:taskOccurrenceKey(item)})
  if (error) message = 'Kunne ikke gemme udført-status: ' + error.message
  updateCalendarSurface()
}

async function handleDeleteCalendarItem() {
  const item = getEditingCalendarItem()
  if (!item || isCreatingCalendarItem || imported(item) || item.isVirtualMilestone) return
  const form = document.querySelector('#calendar-modal-form'), scope = String(new FormData(form).get('repeatScope') || 'one')
  isCreatingCalendarItem = true
  const button = document.querySelector('#calendar-modal-delete'); button.disabled = true
  const { error } = await runCalendarMutation(() => planDelete(editingRowsSnapshot, item, scope), {action:'delete', entityId:item.id})
  isCreatingCalendarItem = false
  if (error) { button.disabled = false; form.querySelector('#calendar-editor-message').textContent = error.message; return }
  isCalendarModalOpen = false; editingCalendarItemId = null; editingCalendarSnapshot = null; editingRowsSnapshot = []
  message = 'Kalender-item slettet.'
  await loadCalendarItems()
  render({ preserveDialogs: true })
}

async function handleCreatePerson(event) {
  await handleSavePeopleSettings(event)
}

async function handleSavePeopleSettings(event) {
  event.preventDefault()
  if (!navigator.onLine || syncStatus.offline) { settingsMessage = 'Person- og feedindstillinger kræver forbindelse.'; render({preserveDialogs:true}); return }
  if (isCreatingPerson || !activeHousehold) return
  const householdId = getHouseholdId(activeHousehold)
  const epoch = sessionEpoch
  const newPerson = getNewPersonFormValues(event.target)
  const updates = householdPeople.map(person => ({ existing: person, values: getPersonRowValues(String(person.id)), file: pendingAvatarFiles.get(String(person.id)) }))
  if (newPerson.name) updates.push({ values: newPerson, file: pendingAvatarFiles.get('new') })
  isCreatingPerson = true; settingsMessage = 'Gemmer personer...'; render()
  const errors = []
  for (const update of updates) {
    if (!update.values.name || epoch !== sessionEpoch) continue
    const result = await savePerson(supabase, householdId, update.values, update)
    if (result.error) errors.push(result.error.message)
    else pendingAvatarFiles.delete(update.existing?.id || 'new')
  }
  if (epoch !== sessionEpoch) return
  await loadHouseholdPeople()
  isCreatingPerson = false
  settingsMessage = errors.length ? 'Kunne ikke gemme alle personer: ' + errors.join(', ') : 'Personer gemt.'
  render()
}

async function handleSavePersonRow(personId) {
  if (!navigator.onLine || syncStatus.offline) { settingsMessage = 'Person- og feedindstillinger kræver forbindelse.'; render({preserveDialogs:true}); return }
  if (isCreatingPerson || !activeHousehold) return
  const existing = householdPeople.find(person => person.id === personId)
  if (!existing) return
  const values = getPersonRowValues(personId)
  if (!values.name) { settingsMessage = 'Personen mangler navn.'; render(); return }
  const epoch = sessionEpoch
  isCreatingPerson = true; settingsMessage = 'Gemmer person...'; render()
  const { error } = await savePerson(supabase, getHouseholdId(activeHousehold), values, { existing, file: pendingAvatarFiles.get(personId) })
  if (epoch !== sessionEpoch) return
  if (!error) pendingAvatarFiles.delete(personId)
  await loadHouseholdPeople()
  isCreatingPerson = false
  settingsMessage = error ? 'Kunne ikke gemme person: ' + error.message : 'Person gemt.'
  render()
}

function getPersonRowValues(rowId) {
  const prefix = `person-${rowId}`

  return {
    name: getInputValue(`${prefix}-name`),
    role: mapPersonRoleForDb(getInputValue(`${prefix}-role`)),
    reward_enabled: Boolean(document.getElementById(`${prefix}-reward-enabled`)?.checked),
    color: getInputValue(`${prefix}-color`) || '#64748b',
    avatar_url: getAvatarValue(rowId),
  }
}

function getNewPersonFormValues(form) {
  const formData = new FormData(form)

  return {
    name: String(formData.get('name') || formData.get('new-name') || '').trim(),
    role: mapPersonRoleForDb(formData.get('role') || formData.get('new-role') || 'andet'),
    reward_enabled: formData.has('reward_enabled'),
    color: String(formData.get('color') || formData.get('new-color') || '#64748b').trim() || '#64748b',
    avatar_url: String(formData.get('avatar_url') || formData.get('new-avatar') || '').trim(),
  }
}

function handlePersonAvatarPreview(event) {
  const input = event.target
  const file = input.files?.[0]
  const rowId = input.dataset.personAvatarFile

  if (!file || !rowId) {
    return
  }

  try { validateAvatar(file) } catch (error) { settingsMessage = error.message; render(); return }
  pendingAvatarFiles.set(rowId, file)
  const reader = new FileReader()
  reader.addEventListener('load', () => {
    const avatarValue = document.querySelector(`[data-person-avatar-value="${rowId}"]`)
    const preview = document.querySelector(`[data-avatar-preview="${rowId}"]`)
    const avatarUrl = String(reader.result || '')

    if (avatarValue) {
      avatarValue.value = avatarUrl
    }

    if (preview) {
      preview.innerHTML = renderPersonAvatar({
        name: getPersonPreviewName(rowId),
        color: getPersonPreviewColor(rowId),
        avatar_url: avatarUrl,
      }, 'person-settings-avatar')
    }
  })
  reader.readAsDataURL(file)
}

function handlePersonColorPreview(event) {
  const input = event.target
  const rowId = input.dataset.personColorInput
  const swatch = document.querySelector(`[data-person-color-swatch="${rowId}"]`)

  if (swatch) {
    swatch.style.background = input.value
  }

  updateInitialAvatarPreview(rowId)
}

function handlePersonInitialPreview(event) {
  updateInitialAvatarPreview(event.target.dataset.personNameInput)
}

function updateInitialAvatarPreview(rowId) {
  const preview = document.querySelector(`[data-avatar-preview="${rowId}"]`)
  const avatarUrl = getAvatarValue(rowId)

  if (!preview || avatarUrl) {
    return
  }

  preview.innerHTML = renderPersonAvatar({
    name: getPersonPreviewName(rowId),
    color: getPersonPreviewColor(rowId),
    avatar_url: '',
  }, 'person-settings-avatar')
}

function getInputValue(id) {
  return String(document.getElementById(id)?.value || '').trim()
}

function getAvatarValue(rowId) {
  return String(document.querySelector(`[data-person-avatar-value="${rowId}"]`)?.value || '').trim()
}

function getPersonPreviewName(rowId) {
  if (rowId === 'new') {
    return getInputValue('person-name') || 'Person'
  }

  return getInputValue(`person-${rowId}-name`) || 'Person'
}

function getPersonPreviewColor(rowId) {
  if (rowId === 'new') {
    return getInputValue('person-color') || '#64748b'
  }

  return getInputValue(`person-${rowId}-color`) || '#64748b'
}

function openCreateCalendarModal(date = null,type='Aktivitet') {
  if(mode()==='kiosk')return
  newCalendarType=type
  editingCalendarItemId = null; editingCalendarSnapshot = null; editingRowsSnapshot = []
  newCalendarDate = date || toDateIso(calendarCursorDate)
  isCalendarModalOpen = true; message = ''
  render()
}

function openEditCalendarModal(itemId) {
  detailRoot.innerHTML=''
  rewardsUI.close()

  if(mode()==='kiosk'){const item=findRenderableCalendarItem(itemId);if(item)planEditor.view({title:getCalendarItemTitle(item),date:formatDayHeaderDate(parseDateIso(item.date)),time:item.time,note:getCalendarValue(item,'note'),location:getCalendarValue(item,'location'),people:getCalendarItemPeople(item).join(', '),source:sourceLabel(item)});return}
  const item = findRenderableCalendarItem(itemId)
  if (!item) return
  if(imported(item)&&canEditImported(item)){importedEditor.open(item);return}
  editingCalendarItemId = itemId
  editingCalendarSnapshot = structuredClone(item)
  editingRowsSnapshot = structuredClone(calendarItems)
  isCalendarModalOpen = true; message = ''
  render()
}

function closeCalendarModal() {
  newCalendarType='Aktivitet'
  isCalendarModalOpen = false
  editingCalendarItemId = null
  render()
}

function openSettingsModal(tab='people') {
  tab=typeof tab==='string'?tab:'people'
  if(mode()==='kiosk'&&!kioskUnlocked){requestKioskAccess(tab);return}
  settingsTab=tab
  isSettingsModalOpen = true
  settingsMessage = ''
  calendarImportMessage = ''
  render()
}

function closeSettingsModal() {
  kioskUnlocked=false
  pendingAvatarFiles.clear()
  isSettingsModalOpen = false
  settingsMessage = ''
  calendarImportMessage = ''
  importingCalendarFeedId = null
  calendarFeedImportMessages = {}
  editingCalendarFeedId = null
  calendarFeedDraft = createEmptyCalendarFeedDraft()
  render()
}

async function handleImportCalendarFeed(event) {
  if (!navigator.onLine || syncStatus.offline) { settingsMessage = 'Person- og feedindstillinger kræver forbindelse.'; render({preserveDialogs:true}); return }
  event?.preventDefault()

  if (importingCalendarFeedId) {
    return
  }

  const feedId = event?.currentTarget?.dataset?.importCalendarFeed
  const feed = calendarFeeds.find((item) => String(item.id) === String(feedId))

  if (!feed || !canManageFeeds() || feed.is_active === false) {
    calendarImportMessage = 'Feed er inaktivt eller utilgængeligt.'
    renderPreservingSettingsScroll()
    return
  }

  importingCalendarFeedId = String(feed.id)
  calendarImportMessage = ''
  setCalendarFeedImportMessage(feed.id, 'Henter feed...', 'loading')
  renderPreservingSettingsScroll()

  let result

  try {
    result = await supabase.functions.invoke('import-calendar-feed', {
      body: { feedId: feed.id },
    })
  } catch (error) {
    importingCalendarFeedId = null
    setCalendarFeedImportMessage(feed.id, `Fejl: ${formatErrorMessage(error?.message || error)}`, 'error')
    renderPreservingSettingsScroll()
    return
  }

  const { data, error } = result

  importingCalendarFeedId = null

  if (error) {
    setCalendarFeedImportMessage(feed.id, `Fejl: ${await getEdgeFunctionErrorMessage(error)}`, 'error')
    renderPreservingSettingsScroll()
    return
  }

  if (data?.success === false) {
    setCalendarFeedImportMessage(feed.id, `Fejl: ${formatErrorMessage(data.error || data.message || data)}`, 'error')
    renderPreservingSettingsScroll()
    return
  }

  activePersonFilter = 'Alle'
  await loadCalendarItems()
  await loadCalendarFeeds()
  const importResult = getCalendarImportResult(feed, data)
  setCalendarFeedImportMessage(feed.id, importResult.text, importResult.feedId ? 'ok' : 'info', {
    dateText: importResult.dateText,
    feedId: importResult.feedId,
  })
  renderPreservingSettingsScroll()
}

function handleGoToImportedCalendarFeed(feedId) {
  const feed = calendarFeeds.find((item) => String(item.id) === String(feedId))
  const summary = feed ? getImportedCalendarItemsSummary(feed) : null
  const date = parseDateIso(summary?.nextDate)

  if (!date) {
    return
  }

  calendarCursorDate = date
  activePersonFilter = 'Alle'
  isSettingsModalOpen = false
  settingsMessage = ''
  calendarImportMessage = ''
  importingCalendarFeedId = null
  render()
}

function openCreateCalendarFeedForm() {
  editingCalendarFeedId = 'new'
  calendarFeedDraft = createEmptyCalendarFeedDraft()
  calendarImportMessage = ''
  render()
}

function openEditCalendarFeedForm(feedId) {
  if (!navigator.onLine || syncStatus.offline) { settingsMessage = 'Person- og feedindstillinger kræver forbindelse.'; render({preserveDialogs:true}); return }
  const feed = calendarFeeds.find((item) => String(item.id) === String(feedId))

  if (!feed) {
    return
  }

  editingCalendarFeedId = String(feed.id)
  calendarFeedDraft = createCalendarFeedDraft(feed)
  calendarImportMessage = ''
  render()
}

function closeCalendarFeedForm() {
  editingCalendarFeedId = null
  calendarFeedDraft = createEmptyCalendarFeedDraft()
  calendarImportMessage = ''
  render()
}

function handleCalendarFeedDraftInput(event) {
  const { name, type, checked, value } = event.target

  if (!name) {
    return
  }

  calendarFeedDraft = {
    ...calendarFeedDraft,
    [name]: type === 'checkbox' ? checked : value,
  }
}

function handleCalendarFeedSourceChange(event) {
  handleCalendarFeedDraftInput(event)
  calendarImportMessage = ''
  updateCalendarImportHelpText(event.target.value)
}

function updateCalendarImportHelpText(source) {
  const helpText = document.querySelector('#calendar-import-help')

  if (helpText) {
    helpText.textContent = getCalendarImportHelpText(source)
  }
}

async function handleSaveCalendarFeed(event) {
  event.preventDefault()
  if (!navigator.onLine || syncStatus.offline) { settingsMessage = 'Person- og feedindstillinger kræver forbindelse.'; render({preserveDialogs:true}); return }

  if (!activeHousehold || isSavingCalendarFeed || !editingCalendarFeedId) {
    return
  }

  if (!canManageFeeds()) return
  let values
  try { values = getCalendarFeedDraftValues() } catch (error) { calendarImportMessage = error.message; render(); return }

  if (!values.feed_url) {
    calendarImportMessage = 'Feed mangler URL.'
    render()
    return
  }

  isSavingCalendarFeed = true
  calendarImportMessage = 'Gemmer feed...'
  render()

  const householdId = getHouseholdId(activeHousehold)
  const saveResult = editingCalendarFeedId === 'new'
    ? await supabase
      .from('calendar_feeds')
      .insert({
        household_id: householdId,
        ...values,
      })
    : await supabase
      .from('calendar_feeds')
      .update(values)
      .eq('id', editingCalendarFeedId)
      .eq('household_id', householdId)

  isSavingCalendarFeed = false

  if (saveResult.error) {
    calendarImportMessage = `Kunne ikke gemme feed: ${saveResult.error.message}`
    render()
    return
  }

  await loadCalendarFeeds()
  editingCalendarFeedId = null
  calendarFeedDraft = createEmptyCalendarFeedDraft()
  calendarImportMessage = 'Feed gemt.'
  render()
}

async function handleDeleteCalendarFeed(feedId) {
  if (!navigator.onLine || syncStatus.offline) { settingsMessage = 'Person- og feedindstillinger kræver forbindelse.'; render({preserveDialogs:true}); return }
  if (!activeHousehold || !feedId) {
    return
  }

  const feed = calendarFeeds.find((item) => String(item.id) === String(feedId))

  if (!feed || !window.confirm(`Slet feedet "${feed.name || 'Uden navn'}"?`)) {
    return
  }

  calendarImportMessage = 'Sletter feed...'
  render()

  const { error } = await supabase
    .from('calendar_feeds')
    .delete()
    .eq('id', feedId)
    .eq('household_id', getHouseholdId(activeHousehold))

  if (error) {
    calendarImportMessage = `Kunne ikke slette feed: ${error.message}`
    render()
    return
  }

  await loadCalendarFeeds()

  if (String(editingCalendarFeedId) === String(feedId)) {
    editingCalendarFeedId = null
    calendarFeedDraft = createEmptyCalendarFeedDraft()
  }

  calendarImportMessage = 'Feed slettet.'
  render()
}

function getCalendarImportHelpText(source = calendarFeedDraft.source) {
  if (source === 'aula') {
    return 'Aula bruger ét kalenderlink pr. barn. Vælg barnet/personen her, og indsæt barnets Aula-link.'
  }

  return 'Brug kalenderens offentlige iCal-/ICS-link.'
}

function navigateCalendar(direction) {
  productRoute='calendar'
  const nextDate = new Date(calendarCursorDate)
  nextDate.setDate(nextDate.getDate() + (calendarViewMode === 'week' ? direction * 7 : direction))
  calendarCursorDate = nextDate
  render()
}

function toggleCalendarViewMode() {
  productRoute='calendar'
  calendarViewMode = calendarViewMode === 'week' ? 'day' : 'week'
  hasUserSelectedCalendarView = true
  try { localStorage.setItem(VIEW_KEY, calendarViewMode) } catch {}
  render()
}

function getEditingCalendarItem() { return editingCalendarSnapshot }

function renderTypeOption(type, currentType) {
  return `
    <option value="${escapeHtml(type)}" ${type === currentType ? 'selected' : ''}>
      ${escapeHtml(type)}
    </option>
  `
}

function renderPersonOptions(currentPerson) {
  const selected = normalizeCalendarPersonName(currentPerson)
  const names = ['Alle']

  householdPeople.filter(isActiveHouseholdPerson).forEach((person) => {
    const name = String(person.name || '').trim()
    if (name && !names.some((item) => item.toLowerCase() === name.toLowerCase())) {
      names.push(name)
    }
  })

  if (selected && !names.some((name) => name.toLowerCase() === selected.toLowerCase())) {
    names.push(selected)
  }

  return names.map((name) => `
    <option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>
      ${escapeHtml(name)}
    </option>
  `).join('')
}

function renderCalendarPersonPills(selectedPeople) {
  const selection = selectPeople(selectedPeople, householdPeople)
  const options = [{ id: 'Alle', name: 'Alle', color: '#0f172a' }, ...householdPeople.filter(person => isActiveHouseholdPerson(person) || selection.personIds.includes(person.id))]
  selection.unresolvedPeople.forEach(name => options.push({ id: name, name, color: '#64748b' }))
  return options.map(person => {
    const checked = person.id === 'Alle' ? selection.people.includes('Alle') : selection.personIds.includes(person.id) || selection.unresolvedPeople.includes(person.id)
    return '<label class="calendar-person-pill ' + (checked ? 'selected' : '') + '" style="--person-color:' + escapeHtml(person.color || '#64748b') +
      '"><input type="checkbox" name="people" value="' + escapeHtml(person.id) + '" data-calendar-person-choice ' + (checked ? 'checked' : '') +
      ' /><span>' + escapeHtml(person.name) + '</span></label>'
  }).join('')
}

function handleCalendarPersonChoice(event) {
  const choices = [...document.querySelectorAll('[data-calendar-person-choice]')]
  const allChoice = choices.find((choice) => normalizeCalendarPersonName(choice.value) === 'Alle')

  if (normalizeCalendarPersonName(event.target.value) === 'Alle' && event.target.checked) {
    choices.forEach((choice) => {
      if (choice !== event.target) {
        choice.checked = false
      }
    })
  }

  if (normalizeCalendarPersonName(event.target.value) !== 'Alle' && event.target.checked && allChoice) {
    allChoice.checked = false
  }

  if (!choices.some((choice) => choice.checked) && allChoice) {
    allChoice.checked = true
  }

  const approval=document.querySelector('[name=requiresApproval]');if(approval&&!getEditingCalendarItem()&&!approval.dataset.manual)approval.checked=choices.filter(c=>c.checked).some(c=>c.value==='Alle'?householdPeople.some(p=>rewardConfig(rewardState,p.id).default_requires_approval):rewardConfig(rewardState,c.value).default_requires_approval)
  choices.forEach((choice) => {
    choice.closest('.calendar-person-pill')?.classList.toggle('selected', choice.checked)
  })
}

function getSelectedCalendarPeople(formData) {
  return normalizeCalendarPeople(formData.getAll('people'))
}

function normalizeCalendarPeople(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || '').split(/[;,]/)
  const names = []

  rawValues.forEach((rawValue) => {
    const name = normalizeCalendarPersonName(rawValue)
    if (name && !names.some((item) => item.toLowerCase() === name.toLowerCase())) {
      names.push(name)
    }
  })

  if (!names.length || names.some((name) => name.toLowerCase() === 'alle')) {
    return ['Alle']
  }

  return names
}

function normalizeCalendarPersonName(person) {
  const name = String(person || '').trim()
  return name || 'Alle'
}

function isActiveHouseholdPerson(person) {
  return person?.active !== false && person?.is_active !== false && person?.archived !== true
}

function syncActivePersonFilter() {
  if (activePersonFilter !== 'Alle' && !householdPeople.some(person => person.id === activePersonFilter && isActiveHouseholdPerson(person))) activePersonFilter = 'Alle'
}

function updateIntervalFields(){
 const form=document.querySelector('#calendar-modal-form');if(!form)return
 const enabled=supportsInterval({type:form.querySelector('#calendar-type').value}),allDay=enabled&&form.querySelector('#calendar-all-day').checked
 form.querySelectorAll('.interval-field').forEach(el=>{el.hidden=!enabled;el.querySelectorAll('input').forEach(input=>input.disabled=!enabled)})
 for(const id of ['calendar-time','calendar-end-time']){const input=form.querySelector('#'+id);input.disabled=allDay||id==='calendar-end-time'&&!enabled;input.parentElement.hidden=allDay||id==='calendar-end-time'&&!enabled}
 form.querySelector('#calendar-duration').parentElement.hidden=enabled
}
function updateModalTypeFields() {
  const type = normalizeTypeValue(document.querySelector('#calendar-type')?.value || 'Aktivitet')
  const isBirthday = type === 'Fødselsdag'
  const isTask = type === 'Opgave'
  const isMilestone = type === 'Mærkedag'

  const birthdayFields = document.querySelector('#birthday-fields')
  const calendarOptions = document.querySelector('#calendar-options')
  const repeatWeeklyOption = document.querySelector('#repeat-weekly-option')
  const weekdaysOption = document.querySelector('#weekdays-option')
  const doneOption = document.querySelector('#done-option')
  const canUseWeekdays = !getEditingCalendarItem() && !isBirthday && !isMilestone

  const readOnly = imported(getEditingCalendarItem()) || getEditingCalendarItem()?.isVirtualMilestone || (managedTask(getEditingCalendarItem())&&!rewardsUI.adult)
  if (readOnly) return
  const titleInput = document.querySelector('#calendar-title')
  if (isTask) titleInput?.setAttribute('list', 'task-suggestions'); else titleInput?.removeAttribute('list')
  birthdayFields?.classList.toggle('hidden', !isBirthday)
  calendarOptions?.classList.toggle('hidden', isBirthday)
  setCheckboxOptionEnabled(repeatWeeklyOption, !isBirthday)
  setCheckboxOptionEnabled(weekdaysOption, canUseWeekdays)
  setCheckboxOptionEnabled(doneOption, isTask)
  updateModalScopeFields()
  setupTaskEditor(isTask)
  updateIntervalFields()
}

function updateModalScopeFields() {
  const item = getEditingCalendarItem()
  if (!item || imported(item) || item.isVirtualMilestone || !repeatContext(item)) return
  const form = document.querySelector('#calendar-modal-form'), scope = form?.querySelector('[name=repeatScope]:checked')?.value || 'one'
  const base = baseFor(editingRowsSnapshot, item), input = form.querySelector('#calendar-date'), weeklyInput = form.querySelector('[name=repeatWeekly]')
  const previousScope = input.dataset.scope
  if (previousScope !== scope) {
    const oldDate=input.value;input.value = scope === 'series' ? base.date : scope === 'future' ? item.occurrenceDate : item.date
    const end=form.querySelector('#calendar-end-date');if(end?.value)end.value=addDays(end.value,daysBetween(oldDate,input.value))
  }
  input.dataset.scope = scope
  input.disabled = scope !== 'one'
  weeklyInput.disabled = scope === 'one' || form.querySelector('#calendar-type').value === 'Fødselsdag'
  form.querySelector('#calendar-scope-help').textContent = scope === 'one'
    ? 'Tilpas kun denne forekomst. Den ugentlige serie fortsætter.'
    : scope === 'future'
      ? 'Ny serie fra denne forekomst. Senere individuelle tilpasninger og udførte opgaver bevares. Datoen er seriens skæringspunkt.'
      : 'Seriens oprindelige startdato bevares. Individuelle tilpasninger bevares. Udført gælder stadig kun denne forekomst.'
}

function setCheckboxOptionEnabled(option, enabled) {
  if (!option) {
    return
  }

  const input = option.querySelector('input')
  option.classList.toggle('hidden', !enabled)

  if (input) {
    input.disabled = !enabled

    if (!enabled) {
      input.checked = false
    }
  }
}

function normalizeTypeValue(type) {
  const normalized = String(type || '').trim()
  const aliases = {
    'FÃ¸dselsdag': 'Fødselsdag',
    'MÃ¦rkedag': 'Mærkedag',
    Fritidsinteresser: 'Fritidsinteresse',
    Mærkedage: 'Mærkedag',
  }

  return aliases[normalized] || normalized || 'Aktivitet'
}

function parseOptionalNumber(value) {
  const trimmed = String(value ?? '').trim()

  if (!trimmed) {
    return null
  }

  const number = Number(trimmed)
  return Number.isFinite(number) ? number : 0
}

function findCreatedHousehold(rpcData, previousIds, name) {
  const createdId = getCreatedHouseholdId(rpcData)

  if (createdId) {
    const household = households.find((item) => String(item.id) === String(createdId))
    return household || { id: createdId, name }
  }

  const newHousehold = households.find((household) => !previousIds.has(String(household.id)))

  if (newHousehold) {
    return newHousehold
  }

  return households.find((household) => getHouseholdName(household) === name) || null
}

function getCreatedHouseholdId(rpcData) {
  const value = Array.isArray(rpcData) ? rpcData[0] : rpcData

  if (!value) {
    return null
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return value
  }

  return value.id || value.household_id || null
}

function getDefaultCalendarViewMode() {
  return preferredView(localStorage, window.innerWidth)
}

function syncDefaultCalendarViewMode() {
  if(productRoute==='today'){calendarViewMode='day';return}
  if (hasUserSelectedCalendarView) {
    return
  }

  calendarViewMode = getDefaultCalendarViewMode()
}

function getCalendarHeaderLabel() {
  if(mode()==='mobile'){
    if(calendarViewMode==='day')return new Intl.DateTimeFormat('da-DK',{weekday:'long',day:'numeric',month:'long'}).format(calendarCursorDate)
    const dates=weekDates(toDateIso(calendarCursorDate)),first=parseDateIso(dates[0]),last=parseDateIso(dates[6]),format=new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'short',...(first.getFullYear()!==last.getFullYear()?{year:'numeric'}:{})})
    return 'Uge '+isoWeek(dates[0]).week+' · '+format.format(first)+' – '+format.format(last)
  }
  return calendarHeading(toDateIso(calendarCursorDate), calendarViewMode)
}

function getDefaultCalendarItemDate() {
  return newCalendarDate || toDateIso(calendarCursorDate)
}

function getVisibleWeekDays() {
  const monday = getStartOfWeek(calendarCursorDate)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return date
  })
}

function getStartOfWeek(date) {
  const start = new Date(date)
  const day = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - day)
  start.setHours(0, 0, 0, 0)
  return start
}

function toDateString(value) { const parsed = parseDateIso(String(value || '').slice(0,10)); return parsed ? toDateIso(parsed) : '' }
function toDateIso(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatWeekday(date) {
  return new Intl.DateTimeFormat('da-DK', { weekday: 'long' }).format(date)
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat('da-DK', { day: '2-digit', month: '2-digit' }).format(date)
}

function formatDayHeaderDate(date) {
  return new Intl.DateTimeFormat('da-DK', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(date)
}

function getRenderableCalendarItems() { const dates=getVisibleCalendarDates(),rows=materialize(calendarOnly(calendarItems),dates);return ['today','tasks'].includes(productRoute)?allowanceTasks(rows,rewardState,productRoute==='today'?[rewardToday()]:dates):rows }

function getVisibleCalendarDates() {
  if(productRoute==='tasks')return taskDates()
  if (calendarViewMode === 'day') {
    return [toDateIso(calendarCursorDate)]
  }

  return getVisibleWeekDays().map(toDateIso)
}

function findRenderableCalendarItem(itemId) {
  return [...getRenderableCalendarItems(),...upcomingItems(calendarItems,householdPeople,activePersonFilter)].find((item) => String(item.id) === String(itemId)) || null
}

function isRepeatContextItem(item) { return repeatContext(item) }

function getCalendarSection(type) {
  const normalized = normalizeTypeValue(type)

  if (normalized === 'Fritidsinteresse') {
    return 'Fritidsinteresse'
  }

  if (normalized === 'Opgave') {
    return 'Opgave'
  }

  return 'Aktivitet'
}

function isBirthdayItem(item) {
  const type = normalizeTypeValue(getCalendarValue(item, 'type'))
  return type === 'Fødselsdag' || Boolean(getCalendarValue(item, 'birthYear'))
}

function isMilestoneItem(item) {
  return normalizeTypeValue(getCalendarValue(item, 'type')) === 'Mærkedag'
}

function doesItemMatchPersonFilter(item) { return itemMatchesPerson(item, activePersonFilter, householdPeople) }

function getCalendarItemColor(item) {
  if (getCalendarItemPeople(item).length !== 1 || getCalendarItemPeople(item)[0] === 'Alle') return '#64748b'
  const person = householdPeople.find(person => person.id === itemPersonIds(item, householdPeople)[0])
  return person?.color || getPersonColor(getCalendarItemPeople(item)[0])
}

function getCalendarItemPeople(item) { return itemPeople(item, householdPeople) }

function getPrimaryCalendarPerson(item) {
  return getCalendarItemPeople(item)[0] || 'Alle'
}

function findHouseholdPersonByName(name) { return findPerson(name, householdPeople) }

function getPersonColor(person) {
  const normalizedPerson = String(person || '').trim().toLowerCase()
  const householdPerson = householdPeople.find((item) => String(item.name || '').trim().toLowerCase() === normalizedPerson)

  if (householdPerson?.color) {
    return householdPerson.color
  }

  const colors = {
    Alle: '#0f172a',
    Far: '#ef4444',
    Mor: '#8b5cf6',
    Carl: '#22c55e',
    Jakob: '#0ea5e9',
    Ida: '#f59e0b',
  }

  return colors[person] || '#64748b'
}

function getHouseholdName(household) {
  return household.name || household.title || household.id
}

function getHouseholdId(household) {
  return household.id || household.household_id
}

function getCalendarValue(item, key) { return calendarValue(item, key) }

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}


function mode() { return resolveMode(window.innerWidth,device,session?.user.id,activeHousehold?.id) }
function settingsForDevice() { return deviceSettings(device,session?.user.id,activeHousehold?.id) }
function applyDeviceAppearance() {
  const config=settingsForDevice(), current=mode()
  document.body.dataset.mode=current
  document.body.dataset.route=productRoute
  document.body.dataset.density=densityFor(current,innerWidth,innerHeight,config.density)
  document.documentElement.style.setProperty('--accent',['#0f172a','#2563eb','#7c3aed','#047857','#be123c'].includes(config.accent)?config.accent:'#0f172a')
  document.documentElement.style.setProperty('--bg',({cloud:'#f6f7f3',warm:'#faf7f2',cool:'#f0f7f8'})[config.tone]||'#f6f7fb')
}
function setProductRoute(route) {
  if(route==='food')route=foodRoute
  if(['meals','shopping','recipes'].includes(route))foodRoute=route
  if(!routeLabels[route]||mode()==='kiosk'&&!['today','calendar','meals','shopping','tasks'].includes(route))return
  productRoute=route;calendarCursorDate=new Date();activePersonFilter='Alle';message=''
  if(route==='today')calendarViewMode='day'
  if(route==='calendar')calendarViewMode=mode()==='kiosk'?'week':getDefaultCalendarViewMode()
  if(mode()!=='kiosk')updateDeviceProfile({lastRoute:route})
  if(route==='tasks')calendarViewMode='day'
  hasUserSelectedCalendarView=true
  render()
}
function renderProductNav() { return renderNavigation(productRoute,mode()==='kiosk',mode()==='mobile') }
function renderProductHeader() {
 if(mode()==='mobile')return '<div class="mobile-brand"><span class="mobile-brand-icon" aria-label="Familiekalender">'+icon('calendar')+'</span><h1>'+escapeHtml(['meals','shopping','recipes'].includes(productRoute)?'Mad & indkøb':routeLabels[productRoute])+'</h1></div>'
 if(mode()==='kiosk')return '<div class="kiosk-heading"><div><p class="eyebrow">'+escapeHtml(getHouseholdName(activeHousehold))+'</p><time id="device-clock"></time><p id="device-date"></p></div><div class="kiosk-label"><span class="ux-live-dot"></span> Et hjem. Alle vores planer.</div></div>'
 return '<div class="ux-brand"><span class="ux-brand-icon">'+icon('calendar')+'</span><div><p class="eyebrow">Familiekalender</p><h1>'+escapeHtml(getHouseholdName(activeHousehold))+'</h1></div></div>'
}
function renderHome() {
 if(mode()==='mobile'){const now=new Date(),greeting=now.getHours()<10?'Godmorgen':now.getHours()<17?'Goddag':'God aften';return '<div class="mobile-today"><header class="mobile-today-heading"><h2>'+escapeHtml(new Intl.DateTimeFormat('da-DK',{weekday:'long',day:'numeric',month:'long'}).format(now))+'</h2><p>'+greeting+', familien</p></header>'+renderMobileDay(now,{heading:false})+'</div>'}
 const now=new Date(),today=toDateIso(now),upcoming=upcomingItems(calendarItems,householdPeople,activePersonFilter)
 const next=upcoming[0],later=upcoming.filter(item=>item.date>today).slice(0,4),kiosk=mode()==='kiosk'
 const daily=allowanceTasks(materialize(calendarOnly(calendarItems),[today]),rewardState,[today]).filter(doesItemMatchPersonFilter)
 const tasks=daily.filter(item=>item.type==='Opgave'),completed=tasks.filter(item=>taskComplete(item,householdPeople,rewardState,activePersonFilter)).length,meals=mealsOn(calendarItems,today),shopping=shoppingItems(calendarItems).filter(item=>!item.done)
 const eventButton=item=>'<button class="upcoming-event" data-upcoming="'+escapeHtml(item.id)+'" style="border-left-color:'+escapeHtml(getCalendarItemColor(item))+'"><span class="upcoming-date">'+escapeHtml(formatShortDate(parseDateIso(item.date)))+' · '+escapeHtml(item.time||'Heldag')+'</span><strong>'+escapeHtml(getCalendarItemTitle(item))+'</strong><span>'+escapeHtml(getCalendarItemPeople(item).join(', '))+'</span></button>'
 const mealCard='<section class="ux-dinner"><div class="ux-dinner-top"><span>'+icon('meals')+'</span><p class="eyebrow">På menuen i aften</p></div>'+(meals.length?meals.map(meal=>'<button data-plan-edit="'+meal.id+'" class="ux-dinner-name"><strong>'+escapeHtml(meal.title)+'</strong>'+(meal.time||!kiosk?'<small>'+escapeHtml(meal.time||'God appetit, allesammen')+'</small>':'')+'</button>').join(''):'<h3>Hvad har I lyst til?</h3><p>'+(kiosk?'Planlæg aftensmaden fra familiens mobil.':'En lille plan gør eftermiddagen lettere.')+'</p>')+(!kiosk?'<button class="ux-link" data-go-route="meals">'+(meals.length?'Se ugens madplan':'Planlæg aftensmad')+' '+icon('arrow')+'</button>':'')+'</section>'
 const greeting=now.getHours()<10?'Godmorgen':now.getHours()<17?'Hej med jer':'God aften'
 return (!kiosk?'<section class="ux-welcome"><div><p class="eyebrow">'+escapeHtml(formatDayHeaderDate(now))+'</p><h3>'+greeting+' <span>— her er jeres dag.</span></h3><p>'+ (daily.length?'Der er '+daily.filter(item=>item.type!=='Opgave').length+' aftaler og '+(tasks.length-completed)+' åbne opgaver i dag.':'En dag med plads til nye planer.')+'</p></div><span class="ux-welcome-sun">'+icon('sun')+'</span></section><div class="ux-day-stats"><button data-go-route="calendar">'+icon('calendar')+'<span><strong>'+daily.filter(item=>item.type!=='Opgave').length+'</strong> aftaler i dag</span>'+icon('arrow')+'</button><button data-go-route="tasks">'+icon('tasks')+'<span><strong>'+completed+' / '+tasks.length+'</strong> opgaver klaret</span>'+icon('arrow')+'</button><button data-go-route="shopping">'+icon('shopping')+'<span><strong>'+shopping.length+'</strong> varer på listen</span>'+icon('arrow')+'</button></div>':'')+
 (!kiosk&&next?'<button class="ux-next-inline" data-upcoming="'+escapeHtml(next.id)+'"><span>'+icon('calendar')+'<small>Næste aftale · '+escapeHtml(next.date===today?(next.time||'I dag'):formatShortDate(parseDateIso(next.date)))+'</small></span><strong>'+escapeHtml(getCalendarItemTitle(next))+'</strong>'+icon('arrow')+'</button>':'')+
 '<div class="home-layout"><div class="day-view">'+renderDayCard(calendarCursorDate)+'</div><aside class="home-aside">'+mealCard+(kiosk?renderKioskProgress(tasks,completed,today):'')+'<section class="panel next-panel"><p class="eyebrow">Næste aftale</p>'+(next?eventButton(next):'<div class="ux-quiet-empty">'+icon('sun')+'<p>Der er ro på kalenderen.</p></div>')+'</section>'+
 (kiosk?(later.filter(item=>item.id!==next?.id).length?'<section class="panel upcoming-panel"><h3>De kommende dage</h3>'+later.filter(item=>item.id!==next?.id).slice(0,2).map(eventButton).join('')+'</section>':'')+renderShortcuts():'')+'</aside></div>'
}
function renderKioskProgress(tasks,completed,today){return '<section class="kiosk-progress"><button data-go-route="tasks"><span>'+icon('tasks')+' Dagens opgaver</span><strong>'+completed+' / '+tasks.length+' klaret</strong></button>'+rewardsUI.summary(true)+'</section>'}
function renderFamilyHome(){
 const people=householdPeople.filter(isActiveHouseholdPerson)
 return '<div class="family-view"><section class="ux-family-intro"><div><p class="eyebrow">Sammen om hverdagen</p><h3>'+escapeHtml(getHouseholdName(activeHousehold))+'</h3><p>'+people.length+' familieprofiler · din rolle er '+escapeHtml(roleLabel(householdRole)).toLocaleLowerCase('da')+'</p></div>'+icon('family')+'</section><div class="ux-family-grid">'+people.map(person=>'<article class="ux-family-person" style="--person-color:'+escapeHtml(person.color||'#64748b')+'">'+renderPersonAvatar(person,'ux-family-avatar')+'<h4>'+escapeHtml(person.name)+'</h4><p>'+escapeHtml({barn:'Barn',voksen:'Voksen',andet:'Familie',child:'Barn',adult:'Voksen'}[person.role]||'Familie')+'</p>'+(rewardEnabled(person)?'<button data-child-day="'+person.id+'">Min dag</button>':'')+(rewardsUI.adult?'<button data-reward-config="'+person.id+'">Opgaver & belønning</button>':'')+'<button data-open-settings="people">Se profil '+icon('arrow')+'</button></article>').join('')+'<button class="ux-add-person" data-open-settings="people">'+icon('plus')+'<strong>Tilføj en person</strong><span>Også børn uden eget login</span></button></div><div class="ux-family-tools">'+[['family','Medlemmer og invitationer','Giv andre adgang til familien.','family'],['feeds','Kalender-import','Saml Aula, Google og andre kalendere.','calendar'],['device','Vægskærm og enhed','Indret denne skærm til jeres hjem.','today'],['appearance','Udseende','Farver og tæthed på denne enhed.','sun'],['account','Din konto','Log ud, eksport og privatliv.','settings']].map(([tab,title,description,i])=>'<button data-open-settings="'+tab+'">'+icon(i)+'<span><strong>'+title+'</strong><small>'+description+'</small></span>'+icon('arrow')+'</button>').join('')+'</div></div>'
}
function renderShortcuts() {
  const config=settingsForDevice().shortcuts,links=[['Homey',config.homey],['Sonos',config.sonos],[config.label||'Genvej',config.custom]]
  return '<div class="kiosk-shortcuts">'+links.filter(([,url])=>url).map(([name,url])=>{
    try{return '<a href="'+escapeHtml(safeShortcut(url,{sonos:name==='Sonos'}))+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(name)+' ↗</a>'}catch{return ''}
  }).join('')+'</div>'
}
function renderTaskView() {
  if(mode()==='kiosk'&&taskRange==='month')taskRange='week'
  const dates=taskDates()
  const tasks=allowanceTasks(materialize(calendarItems,dates,{milestones:false}),rewardState,dates).filter(item=>item.type==='Opgave'&&!rewardRule(item).pool&&doesItemMatchPersonFilter(item))
  const open=tasks.filter(item=>!taskComplete(item,householdPeople,rewardState,activePersonFilter)),done=tasks.filter(item=>taskComplete(item,householdPeople,rewardState,activePersonFilter))
  const group=items=>dates.map(date=>{
    const daily=items.filter(item=>item.date===date)
    return daily.length?'<section class="task-date-group"><h3>'+escapeHtml(formatDayHeaderDate(parseDateIso(date)))+'</h3>'+daily.map(renderCalendarItemCard).join('')+'</section>':''
  }).join('')
  return '<div class="task-view rewards-task-view"><p id="reward-message" role="status"></p>'+(activePersonFilter==='Alle'?rewardsUI.summary():rewardsUI.dashboard(activePersonFilter))+rewardsUI.approvals()+(activePersonFilter==='Alle'?renderTaskCapture(tasks,done):'')+'<div class="segmented-control"><button data-task-range="today" aria-pressed="'+(taskRange==='today')+'">I dag</button><button data-task-range="week" aria-pressed="'+(taskRange==='week')+'">Denne uge</button>'+(mode()!=='kiosk'?'<button data-task-range="month" aria-pressed="'+(taskRange==='month')+'">Måned</button><button data-task-range="rewards" aria-pressed="'+(taskRange==='rewards')+'">Belønninger</button>':'')+'</div>'+
    (taskRange==='rewards'?rewardsUI.shop(activePersonFilter):
    (open.length?group(open):'<div class="panel empty-state">Ingen åbne opgaver. Godt gået.</div>')+
    (done.length?'<details class="completed-tasks" data-completed-date="task-view" '+(expandedTaskDays.has('task-view')?'open':'')+'><summary>'+done.length+' udførte opgaver</summary>'+group(done)+'</details>':'')+rewardsUI.bonus(activePersonFilter)+rewardsUI.history(activePersonFilter))+'</div>'
}
function bindProductSurface() {
  document.querySelectorAll('[data-day-detail]').forEach(b=>b.onclick=()=>openDayDetail(b.dataset.dayDetail))

  rewardsUI.bind()
  document.querySelectorAll('[data-upcoming]').forEach(button=>button.onclick=()=>openEditCalendarModal(button.dataset.upcoming))
  document.querySelectorAll('[data-task-range]').forEach(button=>button.onclick=()=>{taskRange=button.dataset.taskRange;updateCalendarSurface()})
  document.querySelectorAll('[data-quick-type]').forEach(button=>button.onclick=()=>{openCreateCalendarModal(toDateIso(new Date()),button.dataset.quickType)})
  bindPlanningSurface()
}
function bindProductControls(freshSettings=true) {
  document.querySelectorAll('[data-product-route]').forEach(button=>button.onclick=()=>setProductRoute(button.dataset.productRoute))
  document.querySelector('#accept-invite')?.addEventListener('click',acceptInvitation)
  document.querySelectorAll('[data-settings-tab]').forEach(button=>button.onclick=()=>selectSettingsTab(button.dataset.settingsTab))
  if(freshSettings){
  document.querySelectorAll('[data-archive-person]').forEach(button=>button.onclick=()=>archivePerson(button.dataset.archivePerson))
  document.querySelectorAll('[data-copy-calendar-feed]').forEach(button=>button.onclick=async()=>{
    try{await navigator.clipboard.writeText(calendarFeeds.find(f=>f.id===button.dataset.copyCalendarFeed)?.feed_url||'');button.textContent='Kopieret'}catch{calendarImportMessage='Kunne ikke kopiere. Brug Rediger for at se linket.';render({preserveDialogs:true})}
  })
  document.querySelector('#device-settings-form')?.addEventListener('submit',saveDeviceSettings)
  document.querySelector('#exit-kiosk')?.addEventListener('click',()=>{delete device.kiosk;persistDevice();void wakeScreen.set(false);kioskUnlocked=false;closeSettingsModal();setProductRoute('calendar')})
  document.querySelector('#appearance-form')?.addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(event.target)
    updateDeviceProfile({accent:data.get('accent'),tone:data.get('tone'),density:data.get('density')});applyDeviceAppearance()
    document.querySelector('#appearance-message').textContent='Udseende gemt på denne enhed.'
  })
  bindAccountControls()
  document.querySelector('#account-logout')?.addEventListener('click',handleLogout)
  document.querySelector('#account-password')?.addEventListener('click',()=>{isSettingsModalOpen=false;authScreen='recovery';message='';render()})
  document.querySelector('#invite-form')?.addEventListener('submit',createInvitation)
  }
  bindProductSurface();clock.tick()
}
function selectSettingsTab(tab) {
  settingsTab=tab
  document.querySelectorAll('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==tab)
  document.querySelectorAll('[data-settings-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.settingsTab===tab)))
  if(tab==='family')void loadMemberships()
}
function renderSettingsNavigation() {
  return '<nav class="settings-nav" aria-label="Indstillingssektioner">'+[['family','Familie'],['people','Personer'],['feeds','Kalender-import'],['device','Enhed / Kiosk'],['appearance','Udseende'],['account','Konto']].map(([id,label])=>'<button type="button" data-settings-tab="'+id+'" aria-pressed="'+(settingsTab===id)+'">'+label+'</button>').join('')+'</nav>'
}
function renderOtherSettings() {
 const config=settingsForDevice(),kiosk=mode()==='kiosk'
 const panel=(id,html)=>'<section class="settings-block" data-settings-panel="'+id+'" '+(settingsTab===id?'':'hidden')+'>'+html+'</section>'
 return panel('family','<h3>Familiemedlemmer med login</h3><p class="hint">Børneprofiler behøver ikke et login. Personer i kalenderen administreres under Personer.</p><div id="family-admin-content">'+renderMembers()+'</div>'+
 (canManageFeeds()?'<form id="invite-form" class="stack-form"><h4>Invitér via email</h4><label for="invite-email">Email</label><input id="invite-email" name="email" type="email" required autocomplete="email"><label for="invite-role">Rolle</label><select id="invite-role" name="role"><option value="adult">Voksen</option>'+(householdRole==='owner'?'<option value="admin">Administrator</option>':'')+'</select><p class="hint">Opret et personligt link, og del det via email. Modtageren skal logge ind med denne email.</p><button type="submit">Opret invitation</button><p id="invite-message" class="message" role="status"></p><div id="invite-result"></div></form>':'<p>Kun ejer og administrator kan invitere.</p>'))+
 panel('device','<h3>Denne enhed</h3><p>Indstillingerne gælder kun her og for '+escapeHtml(getHouseholdName(activeHousehold))+'.</p><form id="device-settings-form" class="stack-form"><label class="checkbox-label"><input id="device-kiosk" name="kiosk" type="checkbox" '+(kiosk?'checked':'')+'>Brug som vægskærm</label>'+
 (!kiosk?'<label for="device-pin">Vælg en enheds-PIN (4–8 cifre)</label><input id="device-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" autocomplete="new-password"><p class="hint">PIN beskytter mod utilsigtet administration på skærmen.</p>':'<p>Administration er beskyttet af enhedens PIN.</p>')+
 '<label class="checkbox-label"><input id="device-wake" name="wake" type="checkbox" '+(config.wake?'checked':'')+'>Hold skærmen vågen</label><p id="wake-status" class="hint">'+escapeHtml(wakeScreen.status)+'</p><label for="device-idle">Tilbage til I dag efter inaktivitet</label><select id="device-idle" name="inactivity">'+[10,15,20,30].map(n=>'<option value="'+n+'" '+(n===config.inactivity?'selected':'')+'>'+n+' minutter</option>').join('')+'</select><h4>Genveje på vægskærm</h4>'+
 [['homey','Homey URL'],['sonos','Sonos URL / app-link'],['custom','Andet link'],['label','Navn på andet link']].map(([key,label])=>'<label for="shortcut-'+key+'">'+label+'</label><input id="shortcut-'+key+'" name="'+key+'" value="'+escapeHtml(config.shortcuts[key])+'" '+(key==='label'?'maxlength="40"':'type="text" placeholder="https://"')+'>').join('')+
 '<button type="submit">Gem enhed</button><p id="device-message" class="message" role="status"></p></form>'+(kiosk?'<button id="exit-kiosk" class="danger-button">Afslut vægskærmstilstand</button>':''))+
 panel('appearance','<h3>Udseende på denne enhed</h3><form id="appearance-form" class="stack-form"><label for="appearance-accent">Primærfarve</label><select id="appearance-accent" name="accent">'+[['#0f172a','Midnat'],['#2563eb','Blå'],['#7c3aed','Lilla'],['#047857','Grøn'],['#be123c','Bær']].map(([value,label])=>'<option value="'+value+'" '+(config.accent===value?'selected':'')+'>'+label+'</option>').join('')+'</select><label for="appearance-tone">Baggrund</label><select id="appearance-tone" name="tone">'+[['cloud','Lys'],['warm','Varm'],['cool','Kølig']].map(([value,label])=>'<option value="'+value+'" '+(config.tone===value?'selected':'')+'>'+label+'</option>').join('')+'</select><label for="appearance-density">Tæthed</label><select id="appearance-density" name="density">'+[['auto','Automatisk'],['compact','Kompakt'],['comfortable','Luftig']].map(([value,label])=>'<option value="'+value+'" '+(config.density===value?'selected':'')+'>'+label+'</option>').join('')+'</select><button type="submit">Gem udseende</button><p id="appearance-message" role="status"></p></form>')+
 panel('account','<h3>Konto</h3><p>'+escapeHtml(session?.user.email||'Offline session')+'</p><p>'+escapeHtml(roleLabel(householdRole))+' i '+escapeHtml(getHouseholdName(activeHousehold))+'</p><div class="account-actions"><button id="account-password">Skift adgangskode</button><button id="account-logout">Log ud</button></div><p class="hint">Log ud rydder lokale kalenderdata og usynkroniseret arbejde. Vægskærmens indstillinger bevares til dit næste login.</p><h4>Dine data</h4><button id="export-family" type="button">Eksportér mine familiedata</button><p id="export-message" role="status"></p><p><a href="/privacy">Privatliv</a> · <a href="/support">Support</a></p>'+(platform.native?'<h4>Notifikationer</h4><button id="enable-push" type="button">Tillad notifikationer</button><p id="push-status" role="status">Påmindelser er endnu ikke aktiveret.</p>':'')+'<h4>Kontosletning</h4><button id="start-delete-account" type="button" class="danger-button">Slet min konto</button><div id="delete-account-content"></div>')
}
function renderMembers() {
 if(!navigator.onLine)return '<p>Opret forbindelse for at se familiens logins og invitationer.</p>'
 return '<ul class="member-list">'+members.map(row=>'<li><span>'+escapeHtml(row.email)+(row.user_id===session?.user.id?' · dig':'')+'</span><strong>'+escapeHtml(roleLabel(row.role))+'</strong></li>').join('')+'</ul>'+
 (canManageFeeds()?'<h4>Invitationer</h4><ul class="member-list">'+invitations.map(inv=>'<li><span>'+escapeHtml(inv.email)+'<small>'+escapeHtml(roleLabel(inv.role))+' · '+invitationStatus(inv)+'</small></span>'+(invitationStatus(inv)==='Afventer'?'<button data-revoke-invite="'+inv.id+'">Tilbagekald</button>':'')+'</li>').join('')+'</ul>':'')
}
async function loadMemberships() {
 if(!navigator.onLine||!activeHousehold)return
 const id=activeHousehold.id,epoch=sessionEpoch
 const [users,invites]=await Promise.all([supabase.rpc('list_household_members',{p_household_id:id}),canManageFeeds()?supabase.from('household_invitations').select('id,email,role,expires_at,accepted_at,revoked_at').eq('household_id',id).order('created_at',{ascending:false}):Promise.resolve({data:[]})])
 if(epoch!==sessionEpoch||activeHousehold?.id!==id)return
 members=users.data||[];invitations=invites.data||[]
 const target=document.querySelector('#family-admin-content')
 if(target){target.innerHTML=users.error||invites.error?'<p>Kunne ikke hente medlemmer. Prøv igen, når forbindelsen er tilbage.</p>':renderMembers();target.querySelectorAll('[data-revoke-invite]').forEach(button=>button.onclick=async()=>{
   button.disabled=true;const {error}=await supabase.rpc('revoke_household_invitation',{p_invitation_id:button.dataset.revokeInvite})
   if(error){button.disabled=false;document.querySelector('#invite-message').textContent='Kunne ikke tilbagekalde invitationen.'}else await loadMemberships()
 })}
}
async function createInvitation(event) {
 event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]'),data=new FormData(form),email=String(data.get('email')).trim()
 if(!publicUrl){form.querySelector('#invite-message').textContent='Appens offentlige adresse mangler i denne build.';return}
 button.disabled=true
 const {data:token,error}=await supabase.rpc('invite_household_member',{p_household_id:activeHousehold.id,p_email:email,p_role:data.get('role')})
 const info=form.querySelector('#invite-message')
 if(error){button.disabled=false;info.textContent='Kunne ikke oprette invitation: '+error.message;return}
 const link=inviteLink(publicUrl,token)
 form.querySelector('#invite-result').innerHTML='<label for="new-invite-link">Invitationslink · vises kun nu</label><input id="new-invite-link" readonly><div class="account-actions"><button id="copy-invite" type="button">Kopiér link</button><a id="email-invite">Åbn email</a></div>'
 form.querySelector('#new-invite-link').value=link
 form.querySelector('#email-invite').href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent('Invitation til Familiekalender')+'&body='+encodeURIComponent('Du er inviteret til vores familiekalender. Log ind eller opret en bruger med denne email, og acceptér invitationen:\n'+link)
 form.querySelector('#copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(link);info.textContent='Link kopieret. Del det med modtageren.'}catch{info.textContent='Markér og kopiér linket i feltet ovenfor.'}}
 info.textContent='Invitation oprettet. Del linket via email; gyldigt i 7 dage.'
 await loadMemberships();button.disabled=false
}
function renderInvitation() { return pendingInvite?'<section class="panel invitation-banner"><p>Du har en familieinvitation. Brug den email, invitationen blev sendt til.</p><button id="accept-invite" type="button">Acceptér invitation</button>'+(!platform.native?'<p><a href="familiekalender://invite#invite='+encodeURIComponent(pendingInvite)+'">Åbn invitation i appen</a></p>':'')+'<p id="invite-accept-message" role="status"></p></section>':'' }
async function acceptInvitation() {
 const button=document.querySelector('#accept-invite');button.disabled=true
 const {data,error}=await supabase.rpc('accept_household_invitation',{p_token:pendingInvite})
 if(error){document.querySelector('#invite-accept-message').textContent='Invitationen er udløbet, tilbagekaldt eller til en anden email. Kontrollér også, at din email er bekræftet.';button.disabled=false;return}
 pendingInvite='';sessionStorage.removeItem('familiekalender.pending-invite');await loadHouseholds()
 await activateHousehold(households.find(h=>h.id===data));render();await refreshHousehold()
}
async function archivePerson(id) {
 if(!navigator.onLine)return
 const person=householdPeople.find(p=>p.id===id),button=document.querySelector('[data-archive-person="'+id+'"]');button.disabled=true
 const archive=person.is_active!==false
 const {error}=await supabase.from('household_people').update({is_active:!archive,...(archive?{reward_enabled:false}:{})}).eq('id',id).eq('household_id',activeHousehold.id)
 if(error){settingsMessage='Kunne ikke ændre personen: '+error.message}else{await loadHouseholdPeople();settingsMessage=archive?'Person arkiveret. Historikken er bevaret, og opgavebelønning er slået fra.':'Person gendannet. Du kan slå opgavebelønning til igen.'}
 render()
}
function persistDevice() {saveDevice(localStorage,device,deviceKey)}
function updateDeviceProfile(values) {
 const key=session.user.id+':'+activeHousehold.id
 device={...device,profiles:{...device.profiles,[key]:{...settingsForDevice(),...values}}};persistDevice()
}
async function saveDeviceSettings(event) {
 event.preventDefault();const before=structuredClone(device),form=event.target,data=new FormData(form),button=form.querySelector('button[type=submit]');button.disabled=true
 try{
   const shortcuts=Object.fromEntries(['homey','sonos','custom'].map(key=>[key,safeShortcut(data.get(key),{sonos:key==='sonos'})]));shortcuts.label=String(data.get('label')||'').slice(0,40)
   if(data.has('kiosk')&&mode()!=='kiosk')device.kiosk={userId:session.user.id,householdId:activeHousehold.id,pin:await makePin(String(data.get('pin')||''))}
   else if(!data.has('kiosk'))delete device.kiosk
   updateDeviceProfile({shortcuts,wake:data.has('wake'),inactivity:[10,15,20,30].includes(Number(data.get('inactivity')))?Number(data.get('inactivity')):15})
   await wakeScreen.set(data.has('wake')&&mode()==='kiosk')
   isSettingsModalOpen=false;kioskUnlocked=false;setProductRoute(mode()==='kiosk'?'today':'calendar')
 }catch(error){device=before;form.querySelector('#device-message').textContent=error.message;button.disabled=false}
}
function requestKioskAccess(tab) {
 pinRoot.innerHTML='<div id="pin-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pin-title"><form id="pin-form" class="calendar-modal stack-form"><header class="modal-header"><h2 id="pin-title">Enhedsindstillinger</h2><button id="pin-close" type="button" aria-label="Luk">×</button></header><label for="kiosk-pin">Enheds-PIN</label><input id="kiosk-pin" type="password" inputmode="numeric" autocomplete="off"><button type="submit">Åbn indstillinger</button><button id="pin-use-account" type="button">Glemt PIN? Brug din adgangskode</button><p id="pin-message" role="status"></p></form></div>'
 const form=pinRoot.querySelector('form');let useAccount=false
 pinRoot.querySelector('#pin-close').onclick=()=>pinRoot.innerHTML=''
 pinRoot.querySelector('#pin-use-account').onclick=()=>{useAccount=true;form.querySelector('label').textContent='Din kontos adgangskode';form.querySelector('input').inputMode='text';form.querySelector('input').value='';form.querySelector('#pin-message').textContent='Bekræft '+(session.user.email||'din konto')+' for at få adgang.'}
 form.onsubmit=async event=>{
  event.preventDefault();const button=form.querySelector('button[type=submit]'),info=form.querySelector('#pin-message');button.disabled=true
  try{
   if(Date.now()<pinBlockedUntil)throw Error('Vent et øjeblik, og prøv igen.')
   let valid=false
   if(useAccount){const {data,error}=await supabase.auth.signInWithPassword({email:session.user.email,password:form.querySelector('input').value});valid=!error&&data.user?.id===session.user.id}
   else valid=await checkPin(form.querySelector('input').value,device.kiosk.pin)
   if(!valid){pinAttempts++;if(pinAttempts>=5){pinBlockedUntil=Date.now()+30000;pinAttempts=0}throw Error('Forkert PIN eller adgangskode.')}
   pinAttempts=0;kioskUnlocked=true;pinRoot.innerHTML='';openSettingsModal(tab)
  }catch(error){info.textContent=error.message;button.disabled=false}
 }
}
function installProductRuntime() {
 const disposeA11y=installDialogAccessibility()
 document.addEventListener('dismiss-dialog',event=>{
   const id=event.target.id
   if(id==='calendar-modal')closeCalendarModal()
   else if(id==='settings-modal')closeSettingsModal()
   else if(id==='sync-panel-backdrop'){syncPanelOpen=false;renderSyncPanel()}
   else if(id==='pin-modal')pinRoot.innerHTML=''
 })
 const interact=()=>{clock.touch();if(mode()==='kiosk')void wakeScreen.request()}
 document.addEventListener('pointerdown',interact,{passive:true});document.addEventListener('keydown',interact)
 document.addEventListener('visibilitychange',()=>{void wakeScreen.visibility();if(!document.hidden)clock.tick()})
 let resizeTimer
 window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{applyDeviceAppearance();if(session&&!isCalendarModalOpen&&!isSettingsModalOpen)render({preserveDialogs:true})},100)})
 clock.start()
 if(import.meta.hot)import.meta.hot.dispose(()=>{clock.stop();disposeA11y();void wakeScreen.set(false);rewardMotion.dispose()})
}

function handleNativeBack(){
 const dialog=[...document.querySelectorAll('[role="dialog"]')].filter(el=>!el.hidden).at(-1)
 if(dialog){dialog.dispatchEvent(new CustomEvent('dismiss-dialog',{bubbles:true}));return}
 if(mode()==='kiosk')return
 if(productRoute!=='today'){setProductRoute('today');return}
 void App.minimizeApp()
}
async function handleAppUrl(url){
 const link=parseAppLink(url,{base:publicUrl,localOrigin:location.origin})
 if(!link)return
 if(link.kind==='invite'){
  pendingInvite=link.token;sessionStorage.setItem('familiekalender.pending-invite',pendingInvite)
  render({preserveDialogs:true});return
 }
 if(link.kind==='calendar'){pendingCalendarLink=link;applyCalendarLink();return}
 if(link.kind==='auth-error'){message='Linket er udløbet eller ugyldigt. Bed om et nyt login- eller nulstillingslink.';authScreen='login';render();return}
 try{
  if(link.recovery){authScreen='recovery';sessionStorage.setItem('familiekalender.recovery','1')}
  const next=await consumeAuthLink(supabase,link)
  await applySession(next)
  history.replaceState(null,'','/')
  render()
 }catch(error){authScreen='login';sessionStorage.removeItem('familiekalender.recovery');message=error.message;render()}
}
function applyCalendarLink(){
 if(!pendingCalendarLink||!session||!activeHousehold||isCalendarModalOpen||isSettingsModalOpen)return
 const link=pendingCalendarLink;pendingCalendarLink=null;productRoute='calendar';calendarCursorDate=parseDateIso(link.date)
 calendarViewMode='day';render({preserveDialogs:true})
 // Item links select a date; access remains scoped to the active household.
 if(link.item&&!calendarItems.some(item=>item.id===link.item)){message='Aftalen findes ikke i den valgte familie.'}
}
function bindAccountControls(){
 document.querySelector('#start-delete-account')?.addEventListener('click',loadAccountDeletion)
 document.querySelector('#enable-push')?.addEventListener('click',async()=>{try{await devices?.request()}catch{document.querySelector('#push-status').textContent='Notifikationer kunne ikke aktiveres.'}})
 document.querySelector('#export-family')?.addEventListener('click',async event=>{
  const info=document.querySelector('#export-message');event.target.disabled=true
  try{await exportFamilyData(supabase,activeHousehold.id);info.textContent='Eksport klar. Gem den et sted, hvor kun du har adgang.'}catch(error){info.textContent=error.message}
  finally{event.target.disabled=false}
 })
}
function renderAccountPage(){
 if(document.querySelector('#delete-account-form'))return
 app.innerHTML='<main class="app-shell public-page"><section class="panel"><p class="eyebrow">Familiekalender</p><h1>Slet min konto</h1><p>'+escapeHtml(session?.user.email||'')+'</p><button id="start-delete-account" class="danger-button">Gennemgå kontosletning</button><div id="delete-account-content"></div><p><a href="/">Til kalenderen</a> · <a href="/privacy">Privatliv</a></p></section></main>'
 bindAccountControls()
}
async function loadAccountDeletion(){
 const target=document.querySelector('#delete-account-content'),button=document.querySelector('#start-delete-account')
 if(!navigator.onLine){target.textContent='Opret forbindelse for at slette din konto.';return}
 button.disabled=true
 const {data:plan,error}=await supabase.rpc('account_deletion_plan')
 button.disabled=false
 if(error){target.textContent='Kunne ikke hente sletteoversigten. Log ind igen og prøv igen.';return}
 target.innerHTML='<form id="delete-account-form" class="stack-form"><h4>Dette kan ikke fortrydes</h4><p>Dit login, din profil, dine medlemskaber og enhedsregistreringer slettes. Forfatterreferencer anonymiseres. Andre ejeres familiedata og børneprofiler bevares. Lokale, usynkroniserede ændringer går tabt.</p>'+
 (plan.pending?'<p>Sletningen er allerede startet. Bekræft din adgangskode igen for at færdiggøre oprydningen.</p>':'')+
 plan.households.map(h=>h.requires_deletion?'<label class="checkbox-label"><input type="checkbox" name="delete-household" value="'+h.id+'" required>Jeg sletter også hele familien '+escapeHtml(h.name)+' ('+h.members+' loginmedlemmer), inklusive kalender, opgaver, personer, feeds, avatarer og opskrifter med billeder.</label>':'<p>Familien '+escapeHtml(h.name)+' bevares. Dit medlemskab fjernes.</p>').join('')+
 '<p>Som eneste ejer skal du bekræfte familiesletning. Afbryd flowet, hvis familien skal bevares.</p><label for="delete-password">Din nuværende adgangskode</label><input id="delete-password" name="password" type="password" required autocomplete="current-password"><label for="delete-confirmation">Skriv SLET MIN KONTO</label><input id="delete-confirmation" name="confirmation" required autocomplete="off" pattern="SLET MIN KONTO"><button type="submit" class="danger-button">Slet min konto permanent</button><p id="delete-message" role="status"></p></form>'
 target.querySelector('form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,data=new FormData(form),submit=form.querySelector('button[type=submit]'),info=form.querySelector('#delete-message')
  submit.disabled=true;info.textContent='Sletningen behandles…'
  try{
   const result=await supabase.functions.invoke('delete-account',{body:{password:String(data.get('password')),confirmation:String(data.get('confirmation')),delete_household_ids:data.getAll('delete-household')}})
   form.querySelector('#delete-password').value=''
   if(result.error){
    let body;try{body=await result.error.context?.json()}catch{}
    throw Error(body?.error||'Sletningen kunne ikke bekræftes. Log ind igen, og prøv igen.')
   }
   if(!result.data?.deleted)throw Error('Sletningen afventer oprydning. Prøv igen.')
   const uid=session?.user.id
   syncEngine?.stop();realtime.stop();await devices?.detach().catch(()=>{});await clearNativeExports({all:true}).catch(()=>{})
   if(uid)await localStore.clearUser(uid)
   if(uid){device.profiles=Object.fromEntries(Object.entries(device.profiles||{}).filter(([key])=>!key.startsWith(uid+':')));if(device.kiosk?.userId===uid)delete device.kiosk;persistDevice()}
   clearLocalAuth();clearSessionState();pendingInvite='';sessionStorage.removeItem('familiekalender.pending-invite');sessionStorage.removeItem('familiekalender.recovery')
   await supabase.auth.signOut({scope:'local'}).catch(()=>{})
   authScreen='login';message='Din konto og de bekræftede familier er slettet.';render()
  }catch(error){info.textContent=error.message;submit.disabled=false}
 }
}


function renderTaskCapture(tasks,done){
 const ratio=tasks.length?Math.round(done.length/tasks.length*100):0
 return '<section class="ux-task-progress'+(!tasks.length?' is-empty':'')+'"><div><p class="eyebrow">'+(taskRange==='month'?'Månedens fælles indsats':taskRange==='week'?'Ugens fælles indsats':'Dagens fælles indsats')+'</p><h3>'+done.length+' af '+tasks.length+' opgaver klaret</h3><p>'+(tasks.length-done.length?'Små ting, vi hjælpes ad med.':'Der er styr på listen.')+'</p></div><div class="ux-progress-ring" style="--progress:'+ratio+'%"><span>'+ratio+'<small>%</small></span></div></section>'
}
function captureInlineFocus(){
 const input=document.activeElement
 if(!input?.closest('.ux-inline-form'))return null
 return {id:input.id,start:input.selectionStart,end:input.selectionEnd}
}
function restoreInlineFocus(saved){
 if(!saved)return
 const input=document.getElementById(saved.id);input?.focus({preventScroll:true})
 if(input&&typeof saved.start==='number')input.setSelectionRange(saved.start,saved.end)
}
function bindPlanningSurface(){
 recipeUI.bind(document)
 document.querySelectorAll('[data-food-tab]').forEach(button=>button.onclick=()=>setProductRoute(button.dataset.foodTab))
 const dismiss=document.querySelector('#dismiss-message');if(dismiss)dismiss.onclick=()=>{message='';document.querySelector('#message').textContent='';document.querySelector('.ux-notice').hidden=true}
 document.querySelectorAll('[data-go-route]').forEach(button=>button.onclick=()=>setProductRoute(button.dataset.goRoute))
 document.querySelectorAll('[data-product-route]').forEach(button=>button.onclick=()=>setProductRoute(button.dataset.productRoute))
 document.querySelectorAll('[data-open-settings]').forEach(button=>button.onclick=()=>openSettingsModal(button.dataset.openSettings))
 document.querySelectorAll('[data-plan-new]').forEach(button=>button.onclick=()=>{if(mode()!=='kiosk'){const date=button.dataset.planDate||toDateIso(new Date());if(button.dataset.planNew==='meal')recipeUI.choose(date);else planEditor.open(button.dataset.planNew,{date})}})
 document.querySelectorAll('[data-plan-edit]').forEach(button=>button.onclick=()=>{
  const row=calendarItems.find(item=>item.id===button.dataset.planEdit);if(!isHouseholdPlan(row))return;detailRoot.innerHTML=''
  if(recipeId(row)&&libraryRecipes.some(r=>r.id===recipeId(row))){recipeUI.detail(recipeId(row),{meal:row});return}
  if(mode()==='kiosk'){planEditor.view({title:row.title,date:formatDayHeaderDate(parseDateIso(row.date)),time:row.time,note:row.note,recipe:row.data?.recipe});return}
  planEditor.open(row.type===PLAN_TYPES.meal?'meal':'shopping',{id:row.id})
 })
 document.querySelectorAll('[data-meal-week]').forEach(button=>button.onclick=()=>{calendarCursorDate=button.dataset.mealWeek==='0'?new Date():parseDateIso(addDays(toDateIso(calendarCursorDate),Number(button.dataset.mealWeek)*7));updateCalendarSurface()})
 document.querySelectorAll('[data-meal-ingredients]').forEach(button=>button.onclick=async()=>{
  const meal=calendarItems.find(row=>row.id===button.dataset.mealIngredients);if(!meal)return
  if(recipeId(meal)){recipeUI.shopping(recipeId(meal),meal);return}
  button.disabled=true
  try{const drafts=ingredientDrafts(meal.data?.recipe?.ingredients?.length?meal.data.recipe.ingredients:meal.note,calendarItems);if(!drafts.length){message='Ingredienserne er allerede på indkøbslisten.';updateCalendarSurface();return}
   const result=await runCalendarMutation(()=>({upserts:drafts.flatMap(fields=>planCreate(planValues('shopping',fields)).upserts),deleteIds:[],expected:[]}))
   message=result.error?result.error.message:drafts.length+' varer føjet til indkøbslisten.'
  }catch(error){message=error.message}finally{button.disabled=false;updateCalendarSurface()}
 })
 document.querySelectorAll('[data-shopping-toggle]').forEach(input=>input.onchange=async()=>{
  const row=calendarItems.find(item=>item.id===input.dataset.shoppingToggle);if(row?.type!==PLAN_TYPES.shopping)return
  input.disabled=true
  const {error}=await runCalendarMutation(()=>planEdit(calendarItems,row,{...itemValues(row),done:input.checked}),{action:'toggle_done',entityId:row.id})
  if(error)message=error.message;updateCalendarSurface()
 })
 const completed=document.querySelector('.shopping-completed');if(completed){completed.open=shoppingOpen;completed.ontoggle=()=>{shoppingOpen=completed.open}}
 document.querySelector('#clear-shopping')?.addEventListener('click',async()=>{
  const rows=shoppingItems(calendarItems).filter(row=>row.done)
  if(!rows.length||!confirm('Fjern '+rows.length+' købte varer? Varer, I stadig mangler, bliver på listen.'))return
  const {error}=await runCalendarMutation(()=>({upserts:[],deleteIds:rows.map(row=>row.id),expected:rows.map(row=>({id:row.id,updated_at:row.updated_at}))}))
  message=error?error.message:'Købte varer fjernet.';updateCalendarSurface()
 })
 const form=document.querySelector('#shopping-add')
 if(form){
  form.oninput=()=>{shoppingDraft=Object.fromEntries(new FormData(form))}
  form.querySelector('button').disabled=shoppingBusy
  form.onsubmit=async event=>{
   event.preventDefault();if(shoppingBusy)return
   const context=sessionEpoch+':'+activeHousehold?.id,draft={...shoppingDraft};shoppingBusy=true;form.querySelector('button').disabled=true
   try{const values=planValues('shopping',{...draft,location:shoppingCategory(draft.title)}),{error}=await runCalendarMutation(()=>planCreate(values))
    if(context!==sessionEpoch+':'+activeHousehold?.id)return
    if(error)throw error
    if(JSON.stringify(draft)===JSON.stringify(shoppingDraft))shoppingDraft={title:'',note:''}
    message='Varen er føjet til familiens liste.'
   }catch(error){message=error.message}finally{shoppingBusy=false;if(context===sessionEpoch+':'+activeHousehold?.id){updateCalendarSurface();document.querySelector('#shopping-title')?.focus({preventScroll:true})}}
  }
 }
}


function taskDates(){const today=toDateIso(new Date());return taskRange==='month'?monthDates(today):taskRange==='week'?weekDates(today):[today]}
function renderFoodTabs(){return '<nav class="food-tabs" aria-label="Mad og indkøb">'+[['meals','Madplan'],...(mode()==='kiosk'?[]:[['recipes','Opskrifter']]),['shopping','Indkøb']].map(([id,label])=>'<button data-food-tab="'+id+'" aria-pressed="'+(productRoute===id)+'">'+label+'</button>').join('')+'</nav>'}
function openCreateSheet(){
 if(mode()==='kiosk')return
 createRoot.innerHTML='<div id="create-sheet" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-sheet-title"><section class="create-sheet"><header><h2 id="create-sheet-title">Hvad vil du tilføje?</h2><button type="button" data-create-close aria-label="Luk">×</button></header>'+[['Aktivitet','Aktivitet','calendar'],['Opgave','Opgave','tasks'],['meal','Måltid','meals'],['shopping','Indkøbsvare','shopping'],['Fødselsdag','Fødselsdag / mærkedag','sun']].map(([kind,label,i])=>'<button type="button" data-create-kind="'+kind+'">'+icon(i)+'<span>'+label+'</span>'+icon('plus')+'</button>').join('')+'</section></div>'
 createRoot.querySelector('[data-create-close]').onclick=()=>{createRoot.innerHTML=''}
 createRoot.querySelector('.modal-backdrop').onclick=e=>{if(e.target===e.currentTarget)createRoot.innerHTML=''}
 createRoot.querySelectorAll('[data-create-kind]').forEach(button=>button.onclick=()=>{
  const kind=button.dataset.createKind;createRoot.innerHTML=''
  const date=productRoute==='calendar'?toDateIso(calendarCursorDate):toDateIso(new Date())
  if(['meal','shopping'].includes(kind))planEditor.open(kind,{date});else openCreateCalendarModal(date,kind)
 })
}
function renderMobileAgendaItem(item,day){
 if(eventInterval(item).multiDay)return renderDailyIntervalItem(item,day)
 if(managedTask(item))return rewardsUI.taskCard(item,activePersonFilter)
 const title=getCalendarItemTitle(item),type=getCalendarValue(item,'type'),task=type==='Opgave',done=Boolean(getCalendarValue(item,'done')),time=getCalendarValue(item,'time'),location=getCalendarValue(item,'location')
 const badge=renderCalendarItemIcon(item)||icon(type==='Fritidsinteresse'?'sun':'calendar')
 return '<article class="calendar-item mobile-agenda-item '+(done?'is-done':'')+'" data-calendar-item="'+escapeHtml(item.id)+'" tabindex="0" role="button" aria-label="'+escapeHtml(title+' · '+eventDisplayRange(item))+'" style="--agenda-color:'+escapeHtml(getCalendarItemColor(item))+'"><span class="agenda-time'+(task?' is-task':'')+'">'+(task?badge:escapeHtml(time||'Heldag'))+'</span><div class="agenda-content"><strong>'+escapeHtml(title)+'</strong><p class="agenda-meta">'+(!task?'<span class="agenda-type" title="'+escapeHtml(type)+'" aria-label="'+escapeHtml(type)+'">'+badge+'</span>':'')+escapeHtml(getCalendarItemPeople(item).join(', ')||'Alle')+(task&&time?' · '+escapeHtml(time):'')+(location?' · '+escapeHtml(location):'')+'</p>'+renderCalendarRepeatMeta(item)+(sourceLabel(item)?'<span class="calendar-source-badge">'+escapeHtml(sourceLabel(item))+'</span>':'')+'</div>'+(task&&!imported(item)?'<label class="done-toggle"><input type="checkbox" data-calendar-toggle="'+escapeHtml(item.id)+'" '+(done?'checked':'')+' aria-label="'+escapeHtml((done?'Fortryd udført: ':'Markér udført: ')+title)+'"><span class="sr-only">'+(done?'Udført':'Markér udført')+'</span></label>':'')+'</article>'
}
function renderMobileDay(date,{heading=true}={}){
 const day=toDateIso(date),week=productRoute==='calendar'&&calendarViewMode==='week'
 const rows=getRenderableCalendarItems().filter(item=>eventOverlapsDate(item,day)&&doesItemMatchPersonFilter(item)).sort((a,b)=>Number(eventInterval(b).multiDay)-Number(eventInterval(a).multiDay)||(getCalendarValue(a,'time')||'').localeCompare(getCalendarValue(b,'time')||''))
 const appointments=rows.filter(item=>getCalendarValue(item,'type')!=='Opgave'),tasks=rows.filter(item=>getCalendarValue(item,'type')==='Opgave'),meals=mealsOn(calendarItems,day)
 const dayTitle=week?formatWeekday(date)+' '+formatShortDate(date):new Intl.DateTimeFormat('da-DK',{weekday:'long',day:'numeric',month:'long'}).format(date)
 let content
 if(week)content=(rows.length||meals.length?appointments.map(item=>renderMobileAgendaItem(item,day)).join('')+tasks.map(renderCompactTask).join(''):'<p class="agenda-empty">Ingen aftaler</p>')+compactMeals(meals)
 else content=(appointments.length?'<section class="mobile-agenda-section"><h3>Aftaler</h3>'+appointments.map(item=>renderMobileAgendaItem(item,day)).join('')+'</section>':!tasks.length&&!meals.length?'<p class="agenda-empty">Ingen planer</p>':'')+(tasks.length?'<section class="mobile-agenda-section"><h3>Opgaver</h3>'+renderDayItems('Opgave',tasks,day)+'</section>':'')+(meals.length?'<section class="mobile-agenda-section mobile-dinner'+(meals.length===1&&!meals[0].time?' is-title-only':'')+'"><h3>'+icon('meals')+' Aftensmad</h3>'+meals.map(meal=>'<button data-plan-edit="'+meal.id+'"><strong>'+escapeHtml(meal.title)+'</strong>'+(meal.time?'<small>'+escapeHtml(meal.time)+'</small>':'')+'</button>').join('')+'</section>':'')
 return '<article class="day-card mobile-agenda-day '+(day===toDateIso(new Date())?'is-today':'')+'" data-day="'+day+'">'+(heading&&week?'<header class="day-card-header"><strong>'+escapeHtml(dayTitle)+'</strong>'+(day===toDateIso(new Date())?'<span>I dag</span>':'')+'</header>':'')+content+'</article>'
}

init()

async function loadRewardsV2(){
 if(!navigator.onLine||!syncEngine)return
 const engine=syncEngine,generation=engine.writeGeneration,version=++rewardLoadVersion,id=activeHousehold.id
 const {data,error}=await supabase.rpc('get_reward_state',{p_household_id:id}).abortSignal(AbortSignal.timeout(12000))
 if(!error&&engine===syncEngine&&generation===engine.writeGeneration&&version===rewardLoadVersion){rewardMotion.hydrate(data);await engine.snapshot({rewards:data})}
}
async function performRewardAction(action,payload){
 const engine=syncEngine;if(!engine)return {error:new Error('Familien er endnu ikke klar.')}
 if(['complete','undo'].includes(action)){
  const item=allowanceTasks(materialize(calendarItems,[payload.due_date],{milestones:false}),rewardState,[payload.due_date]).find(t=>(t.isRepeatOccurrence?t.baseId:t.id)===payload.item_id&&actionPayload(t,payload.person_id).occurrence_date===payload.occurrence_date)
  if(!item)return {error:new Error('Opgaven findes ikke længere.')}
  const rule=rewardRule(item)
  rewardMotion.taskCheck(payload.item_id,action==='undo'?'open':rule.approval?'pending':'completed',payload.person_id)
  return engine.enqueue({p_upserts:[],p_delete_ids:[],p_expected:[],reward_action:{action,payload,optimistic:{origin_id:rewardOrigin(item),task_id:payload.item_id,title:item.title,reward_mode:rule.mode,star_value:rule.stars,requires_approval:rule.approval}}},{action:'reward_'+action,entityId:rewardOrigin(item)+'|'+payload.occurrence_date+'|'+payload.person_id})
 }
 if(!navigator.onLine||syncStatus.offline)return {error:new Error(action==='redeem'?'Du skal være online for at indløse en belønning.':'Denne handling kræver forbindelse.')}
 if(engine.state.queue.length){await engine.replay();if(engine.state.queue.length)return {error:new Error('Synkronisér de ventende opgaver først.')};}
 engine.writeGeneration++
 const result=await supabase.rpc('reward_action',{p_request_id:crypto.randomUUID(),p_household_id:activeHousehold.id,p_action:action,p_payload:payload})
 if(engine!==syncEngine)return {error:new Error('Familien er skiftet.')}
 if(!result.error){engine.writeGeneration++;await engine.snapshot({rewards:result.data.rewards});if(['config','allowance_save'].includes(action))await loadHouseholdPeople();updateCalendarSurface()}
 return result
}
function setupTaskEditor(isTask){
 const form=document.querySelector('#calendar-modal-form');if(!form)return
 let rewardFields=form.querySelector('#task-reward-fields'),quick=form.querySelector('.task-quick-fields'),advanced=form.querySelector('.task-advanced')
 if(!rewardFields&&isTask){
  const item=getEditingCalendarItem(),grid=form.querySelector('.form-grid'),date=form.querySelector('#calendar-date').parentElement,people=form.querySelector('.calendar-person-pills').parentElement
  form.closest('.calendar-modal').classList.add('task-editor')
  advanced=document.createElement('details');advanced.className='task-advanced full';advanced.innerHTML='<summary>Avanceret</summary><div class="form-grid"></div>'
  for(const id of ['calendar-time','calendar-type','calendar-duration','calendar-location','calendar-note','calendar-birth-year'])advanced.lastElementChild.append(form.querySelector('#'+id).parentElement)
  grid.prepend(people);grid.prepend(form.querySelector('#calendar-title').parentElement)
  people.after(date)
  quick=document.createElement('div');quick.className='task-quick-fields full';quick.innerHTML='<div class="task-quick-dates" aria-label="Hvornår"><button type="button" data-task-day="0">I dag</button><button type="button" data-task-day="1">I morgen</button><button type="button" data-task-day="date">Vælg dato</button></div><label for="task-repeat">Gentagelse</label><select id="task-repeat"><option value="none">Ingen</option><option value="weekly">Hver uge</option><option value="weekdays">Hverdage</option></select>'
  date.append(quick)
  const repeat=form.querySelector('#task-repeat'),weekly=form.querySelector('[name=repeatWeekly]'),weekdays=form.querySelector('[name=weekdays]')
  repeat.value=weekdays.checked?'weekdays':weekly.checked?'weekly':'none';repeat.disabled=weekly.disabled;repeat.querySelector('[value=weekdays]').disabled=!!item
  repeat.onchange=()=>{weekly.checked=repeat.value!=='none';weekdays.checked=repeat.value==='weekdays'}
  // Original controls stay in the form so existing recurrence semantics and keyboard flows remain available.
  advanced.lastElementChild.append(form.querySelector('#calendar-options'));grid.append(advanced)
  rewardFields=document.createElement('fieldset');rewardFields.id='task-reward-fields';rewardFields.className='full';rewardFields.disabled=!rewardsUI.adult
  const configured=calendarValue(item,'rewardMode')||'none',requires=item?!!calendarValue(item,'requiresApproval'):householdPeople.some(p=>rewardConfig(rewardState,p.id).default_requires_approval)
  rewardFields.innerHTML='<details class="task-reward-details"><summary>Belønning <small>valgfrit</small></summary><div class="stack-form"><label for="task-reward-mode">Denne opgave</label><select id="task-reward-mode" name="rewardMode"><option value="none">Ingen belønning</option><option value="stars">Bonus ⭐</option></select><div id="task-stars-fields"><label for="task-star-value">Bonusstjerner</label><input id="task-star-value" type="number" name="starValue" min="1" max="100000" step="1" value="'+(Number(calendarValue(item,'starValue'))||10)+'"><label><input type="checkbox" name="bonusPool" '+(calendarValue(item,'bonusPool')?'checked':'')+'> Frivillig bonusopgave — én person kan tage den</label></div><label><input name="requiresApproval" type="checkbox" '+(requires?'checked':'')+'> Kræver voksengodkendelse</label><p class="hint">Nye belønningsregler gælder fra nu og frem. Afsluttede belønninger bevares.</p></div></details>'
  if(configured==='allowance'){const o=document.createElement('option');o.value='allowance';o.textContent='Tidligere lommepengeopgave · gennemgå aftale';rewardFields.querySelector('select').append(o)}advanced.before(rewardFields);form.querySelector('[name=rewardMode]').value=configured
  const refresh=()=>{const mode=form.querySelector('[name=rewardMode]').value;form.querySelector('#task-stars-fields').hidden=mode!=='stars';form.querySelector('[name=starValue]').required=mode==='stars';const managed=mode!=='none'||form.querySelector('[name=requiresApproval]').checked;setCheckboxOptionEnabled(form.querySelector('#done-option'),!managed)}
  form.querySelector('[name=rewardMode]').onchange=refresh;form.querySelector('[name=requiresApproval]').onchange=ev=>{ev.target.dataset.manual='true';refresh()};refresh()
  quick.querySelectorAll('[data-task-day]').forEach(b=>b.onclick=()=>{const input=form.querySelector('#calendar-date');if(b.dataset.taskDay==='date'){input.focus();input.showPicker?.()}else input.value=addDays(rewardToday(),Number(b.dataset.taskDay))})
 }
 if(rewardFields)rewardFields.hidden=!isTask
 if(quick)quick.hidden=!isTask
 if(advanced&&!isTask)advanced.open=true
 if(isTask){form.querySelector('#task-repeat').disabled=form.querySelector('[name=repeatWeekly]').disabled;document.querySelector('#calendar-modal-title').textContent=getEditingCalendarItem()?'Rediger opgave':'Ny opgave';form.querySelector('button[type=submit]').textContent=getEditingCalendarItem()?'Gem ændringer':'Opret opgave'}
}
async function loadRecipes(){
 if(!syncEngine||!navigator.onLine)return
 const engine=syncEngine,version=++recipeLoadVersion
 const {data,error,stale}=await recipeService.load()
 if(engine!==syncEngine||version!==recipeLoadVersion||stale)return
 if(error){recipeLoadError='Biblioteket kunne ikke opdateres. Viser senest gemte opskrifter.';return}
 const resolved=await recipeService.images(data||[])
 if(engine!==syncEngine||version!==recipeLoadVersion)return
 recipeLoadError='';recipeImages=new Map(resolved.map(r=>[r.image_path,r.image_display_url]));libraryRecipes=resolved
 await engine.snapshot({recipes:(data||[]).map(({image_display_url,...r})=>r)})
 if(recipeUI.detailId&&!recipeUI.busy)recipeUI.detail(recipeUI.detailId,recipeUI.detailOptions||{})
}

function renderHiddenImports(){
 if(!hiddenImportsOpen)return '';
 if(hiddenImportsLoading)return '<p role="status">Henter skjulte aftaler…</p>';
 return '<div class="hidden-imports"><p class="hint">Gendan gør aftalen synlig igen, når den stadig findes i kilden. Gendan fjerner kun den valgte skjuleregel. Andre skjuleregler og lokale tilpasninger bevares.</p>'+
 (hiddenImports.length?hiddenImports.map((row,i)=>'<article><div><strong>'+escapeHtml(row.title)+'</strong><small>'+escapeHtml(row.feed_name)+' · '+escapeHtml(hiddenImportLabel(row))+'</small></div><button type="button" data-restore-import="'+i+'">Gendan</button></article>').join(''):'<p>Ingen skjulte importerede aftaler.</p>')+'</div>';
}
async function loadHiddenImports(){
 const hid=activeHousehold?.id,epoch=sessionEpoch;if(!hid)return;
 hiddenImportsOpen=true;hiddenImportsLoading=true;render();
 const {data,error}=await supabase.rpc('list_hidden_calendar_imports',{p_household_id:hid});
 if(hid!==activeHousehold?.id||epoch!==sessionEpoch)return;
 hiddenImportsLoading=false;if(error){hiddenImportsOpen=false;calendarImportMessage='Kunne ikke hente skjulte aftaler. Prøv igen.'}else hiddenImports=data||[];
 render();
}
async function restoreHiddenImport(index){
 const row=hiddenImports[index],hid=activeHousehold?.id,epoch=sessionEpoch;if(!row||!hid)return;
 const {error}=await supabase.rpc('restore_calendar_import',{p_household_id:hid,p_feed_id:row.feed_id,p_uid:row.uid,p_occurrence:row.occurrence});
 if(hid!==activeHousehold?.id||epoch!==sessionEpoch)return;
 if(error){calendarImportMessage='Kunne ikke gendanne aftalen. Prøv igen.';render();return}
 await refreshHousehold();await loadHiddenImports();
}
