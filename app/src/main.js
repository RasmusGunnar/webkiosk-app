import './style.css'
import { supabase, configurationError } from './lib/supabase'
import { findPerson, selectPeople, itemPeople, itemPersonIds, itemMatchesPerson, feedPerson } from './lib/people.js'
import { avatarDisplayUrl, validateAvatar, resolveAvatarUrls, savePerson } from './lib/avatars.js'
import { normalizeFeedUrl, redactFeedUrl, feedIdOf } from './lib/feeds.js'
import { calendarPayload } from './lib/calendar.js'
import { observeSession } from './lib/auth.js'
import { readAllRows } from './lib/rows.js'
import { calendarHeading, preferredView, VIEW_KEY } from './lib/calendar-dates.js'
import { materialize, displayTitle, value as calendarValue, imported, sourceLabel, repeatContext, baseFor, itemValues, planCreate, planEdit, planDelete, taskSuggestions } from './lib/calendar-semantics.js'
import { calendarRealtime } from './lib/calendar-realtime.js'

const app = document.querySelector('#app')

let sessionEpoch = 0
let authRequestInFlight = false
let householdsLoadFailed = false
let householdRole = null
const pendingAvatarFiles = new Map()
let session = null
let households = []
let activeHousehold = null
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
let message = ''
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
let editingCalendarFeedId = null
let calendarFeedDraft = createEmptyCalendarFeedDraft()
let calendarViewMode = getDefaultCalendarViewMode()
let calendarCursorDate = new Date()
let hasUserSelectedCalendarView = false
let newCalendarDate = null
let editingCalendarSnapshot = null
let editingRowsSnapshot = []
const realtime = calendarRealtime(supabase, async () => {
  if (!session || !activeHousehold) return
  const epoch = sessionEpoch, id = activeHousehold.id
  await Promise.all([loadCalendarItems(), loadHouseholdPeople(), loadCalendarFeeds()])
  if (epoch === sessionEpoch && activeHousehold?.id === id) render({ preserveDialogs: true })
}, state => {
  const indicator = document.querySelector('#calendar-sync-status')
  if (indicator) {
    indicator.textContent = state === 'SUBSCRIBED' ? '' : 'Forbindelsen genoprettes…'
    indicator.dataset.state = state
  }
})

async function init() {
  if (configurationError) { app.innerHTML = '<main class="app-shell"><p>' + escapeHtml(configurationError) + '</p></main>'; return }
  observeSession(supabase, applySession, error => { message = 'Login kunne ikke indlæses: ' + error.message; render() })
  window.addEventListener('online', () => realtime.refresh())
  document.addEventListener('visibilitychange', () => { if (!document.hidden) realtime.refresh() })
  window.matchMedia('(max-width: 699px)').addEventListener('change', () => { if (session) render({ preserveDialogs: true }) })
  setInterval(async () => {
    if (!session || !activeHousehold) return
    const epoch = sessionEpoch
    const refreshed = await resolveAvatarUrls(supabase, householdPeople)
    if (epoch === sessionEpoch) { householdPeople = refreshed; if (!isSettingsModalOpen && !isCalendarModalOpen) render() }
  }, 45 * 60 * 1000)
}
async function applySession(nextSession) {
  if (session?.user?.id === nextSession?.user?.id && session !== null) { session = nextSession; return }
  clearSessionState()
  session = nextSession
  const epoch = sessionEpoch
  if (session) { await loadHouseholds(); if (epoch !== sessionEpoch) return; chooseDefaultHousehold() }
  render()
}
function clearSessionState() {
  realtime.stop()
  editingCalendarSnapshot = null; editingRowsSnapshot = []
  sessionEpoch++
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
  editingCalendarFeedId = null; calendarFeedDraft = createEmptyCalendarFeedDraft()
  pendingAvatarFiles.clear()
  calendarCursorDate = new Date(); message = ''; householdsLoadFailed = false
}
function canManageFeeds() { return ['owner', 'admin'].includes(householdRole) }

function render({ preserveDialogs = false } = {}) {
  if (!session) {
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
  app.innerHTML = `
    <main class="app-shell auth-shell">
      <section class="panel auth-panel">
        <h1>Familiekalender</h1>
        <form id="login-form" class="stack-form">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" required />
          <div class="auth-actions">
            <button type="submit" name="authAction" value="login">Log ind</button>
            <button type="submit" name="authAction" value="signup">Opret bruger</button>
          </div>
        </form>
        <p id="message" class="message">${escapeHtml(message)}</p>
      </section>
    </main>
  `

  document.querySelector('#login-form').addEventListener('submit', handleLogin)
}

function renderCreateFirstHousehold() {
  if (householdsLoadFailed) {
    app.innerHTML = '<main class="app-shell"><p>' + escapeHtml(message) + '</p><button id="retry-households">Prøv igen</button><button id="logout-button">Log ud</button></main>'
    document.querySelector('#retry-households').onclick = async () => { await loadHouseholds(); chooseDefaultHousehold(); render() }
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
        <h2>Households</h2>
        <ul id="households-list">
          <li>Ingen households endnu.</li>
        </ul>
      </section>

      <form id="household-form" class="panel stack-form">
        <h2>Ny household</h2>
        <label for="household-name">Navn</label>
        <input id="household-name" name="name" type="text" required />
        <button type="submit">Opret household</button>
      </form>

      <p id="message" class="message">${escapeHtml(message)}</p>
    </main>
  `

  document.querySelector('#logout-button').addEventListener('click', handleLogout)
  document.querySelector('#household-form').addEventListener('submit', handleCreateHousehold)
}

function renderDashboard(preserveDialogs = false) {
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
  realtime.start(householdId)
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
        <div>
          <p class="eyebrow">Familie</p>
          <h1>${escapeHtml(getHouseholdName(activeHousehold))}</h1>
          <p>Familiens kalender, opgaver og aftaler</p>
        </div>
        <button id="logout-button" class="logout-button" type="button">Log ud</button>
      </header>

      ${renderPersonChips()}

      <section class="calendar-section">
        <div class="section-heading calendar-heading">
          <div>
            <h2>Kalender</h2>
            <p id="calendar-heading-label">${escapeHtml(getCalendarHeaderLabel())}</p>
            <small id="calendar-sync-status" role="status"></small>
          </div>
          <div class="calendar-toolbar">
            <div class="calendar-nav">
              <button id="calendar-prev-button" type="button">Forrige ${navUnit}</button>
              <button id="calendar-today-button" type="button">I dag</button>
              <button id="calendar-next-button" type="button">Næste ${navUnit}</button>
            </div>
            <button id="calendar-toggle-view-button" type="button">${toggleViewLabel}</button>
          </div>
        </div>
        ${renderCalendarView()}
      </section>

      <p id="message" class="message">${escapeHtml(message)}</p>
      <button id="new-calendar-button" class="floating-new-button" type="button">+ Ny</button>
      <button id="settings-button" class="floating-settings-button" type="button" aria-label="Indstillinger" title="Indstillinger">&#9881;</button>
      ${renderCalendarModal()}
      ${renderSettingsModal()}
    </main>
  `

  document.querySelector('#logout-button').addEventListener('click', handleLogout)
  if (savedCalendarModal) document.querySelector('#calendar-modal')?.replaceWith(savedCalendarModal)
  if (savedSettingsModal) document.querySelector('#settings-modal')?.replaceWith(savedSettingsModal)
  for (const [panel, scrollTop] of dialogScroll) panel.scrollTop = scrollTop
  if (restoreInput) { activeInput.focus({ preventScroll: true }); if (selection) activeInput.setSelectionRange(...selection) }
  document.querySelector('#new-calendar-button').addEventListener('click', () => openCreateCalendarModal())
  document.querySelector('#calendar-today-button').addEventListener('click', () => { calendarCursorDate = new Date(); render() })
  document.querySelectorAll('[data-create-on-date]').forEach(button => button.addEventListener('click', () => openCreateCalendarModal(button.dataset.createOnDate)))
  document.querySelector('#settings-button').addEventListener('click', openSettingsModal)
  document.querySelector('#calendar-prev-button').addEventListener('click', () => navigateCalendar(-1))
  document.querySelector('#calendar-next-button').addEventListener('click', () => navigateCalendar(1))
  document.querySelector('#calendar-toggle-view-button').addEventListener('click', toggleCalendarViewMode)

  document.querySelectorAll('[data-calendar-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      toggleCalendarItemDone(checkbox.dataset.calendarToggle, checkbox.checked)
    })
  })

  document.querySelectorAll('[data-calendar-item]').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('[data-calendar-toggle], .done-toggle')) {
        return
      }

      openEditCalendarModal(card.dataset.calendarItem)
    })
    card.addEventListener('keydown', event => { if (event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openEditCalendarModal(card.dataset.calendarItem) } })
  })

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
  document.querySelectorAll('[data-person-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      activePersonFilter = button.dataset.personFilter || 'Alle'
      render()
    })
  })

  if (settingsBackdrop && !savedSettingsModal) {
    settingsBackdrop.addEventListener('click', (event) => {
      if (event.target === settingsBackdrop) {
        closeSettingsModal()
      }
    })
  }
}

function renderCalendarView() {
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
  const people = [{ id: 'Alle', name: 'Alle', color: '#0f172a' }, ...householdPeople.filter(isActiveHouseholdPerson)]
  return '<div class="person-chipbar" aria-label="Personfilter">' + people.map(person =>
    '<button class="person-chip ' + (activePersonFilter === person.id ? 'active' : '') +
    '" type="button" data-person-filter="' + escapeHtml(person.id) + '" style="border-color:' + escapeHtml(person.color || '#64748b') + '">' +
    renderPersonAvatar(person, 'person-chip-avatar') + '<span>' + escapeHtml(person.name) + '</span></button>'
  ).join('') + '</div>'
}

function renderDayCard(date) {
  const dateIso = toDateIso(date)
  const dayItems = getRenderableCalendarItems()
    .filter((item) => getCalendarValue(item, 'date') === dateIso && doesItemMatchPersonFilter(item))
  const sections = [
    { key: 'Aktivitet', label: 'Aktiviteter' },
    { key: 'Fritidsinteresse', label: 'Fritidsinteresser' },
    { key: 'Opgave', label: 'Opgaver' },
  ]

  return `
    <article class="day-card ${dateIso === toDateIso(new Date()) ? 'is-today' : ''}" data-day="${dateIso}">
      <header class="day-card-header">
        <strong>${escapeHtml(formatWeekday(date))}</strong>
        <span>${escapeHtml(formatShortDate(date))}${dateIso === toDateIso(new Date()) ? ' · I dag' : ''}</span>
        <button class="day-add-button" type="button" data-create-on-date="${dateIso}" aria-label="Ny aftale ${dateIso}">+</button>
      </header>

      <div class="day-sections">
        ${sections.map((section) => {
          const items = dayItems.filter((item) => getCalendarSection(getCalendarValue(item, 'type')) === section.key)

          return `
            <section class="calendar-day-section">
              <h3>${section.label}</h3>
              <div class="calendar-items">
                ${items.length ? items.map(renderCalendarItemCard).join('') : '<p class="empty-section">Ingen</p>'}
              </div>
            </section>
          `
        }).join('')}
      </div>
    </article>
  `
}

function renderCalendarItemCard(item) {
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
        <span>${done ? 'Done' : 'Ikke done'}</span>
      </label>
    `
    : ''

  return `
    <article
      class="calendar-item ${itemIcon ? 'has-icon' : ''} ${done ? 'is-done' : ''}"
      data-calendar-item="${escapeHtml(id)}" tabindex="0" role="button" aria-label="${escapeHtml(title)}"
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
  const readOnly = imported(item) || item?.isVirtualMilestone
  const mode = readOnly ? 'Kalenderaftale' : item ? 'Rediger kalender-item' : 'Nyt kalender-item'
  const submitText = item ? 'Gem ændringer' : 'Opret kalender-item'
  const values = {
    title: getCalendarValue(item || {}, 'title'),
    date: (item?.isYearlyOccurrence ? getCalendarValue(base || item, 'date') : getCalendarValue(item || {}, 'date')) || getDefaultCalendarItemDate(),
    time: getCalendarValue(item || {}, 'time'),
    people: item && itemPersonIds(item, householdPeople).length ? [...itemPersonIds(item, householdPeople), ...(item.data?.unresolvedPeople || [])] : getCalendarItemPeople(item || {}),
    type: normalizeTypeValue(getCalendarValue(item || {}, 'type') || 'Aktivitet'),
    durationMin: getCalendarValue(item || {}, 'durationMin'),
    location: getCalendarValue(item || {}, 'location'),
    note: getCalendarValue(item || {}, 'note'),
    done: Boolean(getCalendarValue(item || {}, 'done')),
    repeatWeekly: Boolean(getCalendarValue(base || item || {}, 'repeatWeekly')),
    weekdays: Boolean(getCalendarValue(item || {}, 'weekdays')),
    birthYear: getCalendarValue(item || {}, 'birthYear'),
  }
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
          ${readOnly ? '<p class="source-notice">' + (item.isVirtualMilestone ? 'Automatisk mærkedag fra kalenderens traditionsliste.' : 'Importeret fra ' + sourceLabel(item) + '. Redigér aftalen i kildekalenderen; ændringer kommer med ved næste import.') + '</p>' : ''}
          ${item?.isYearlyOccurrence ? '<p class="source-notice">Ændringer gælder fødselsdagen i alle år. Datoen her er den oprindelige dato.</p>' : ''}
          <fieldset class="calendar-fields" ${readOnly ? 'disabled' : ''}>
          <div class="form-grid">
            <div class="full">
              <label for="calendar-title">Titel</label>
              <input id="calendar-title" name="title" type="text" value="${escapeHtml(values.title)}" maxlength="1000" required />
              <datalist id="task-suggestions">${[...new Set([...taskSuggestions, ...calendarItems.filter(row => row.type === 'Opgave').map(row => row.title)])].map(title => '<option value="' + escapeHtml(title) + '"></option>').join('')}</datalist>
            </div>

            <div>
              <label for="calendar-date">Dato</label>
              <input id="calendar-date" name="date" type="date" value="${escapeHtml(values.date)}" required />
            </div>

            <div>
              <label for="calendar-time">Tid</label>
              <input id="calendar-time" name="time" type="time" value="${escapeHtml(values.time)}" />
            </div>

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

        <section class="settings-block">
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
            <p class="hint">Avatar kan tilføjes senere.</p>
            <footer class="modal-actions">
              <button type="submit" ${isCreatingPerson ? 'disabled' : ''}>${isCreatingPerson ? 'Gemmer...' : 'Gem personer'}</button>
            </footer>
          </form>

          <p class="message">${escapeHtml(settingsMessage)}</p>
        </section>

        <section class="settings-block">
          <div class="settings-block-header">
            <div>
              <h3>Kalender-import</h3>
              <p>Hent begivenheder fra eksterne kalendere</p>
            </div>
            <button id="add-calendar-feed-button" class="btn small" type="button" ${canManageFeeds() ? '' : 'disabled'}>+ Tilf&oslash;j feed</button>
          </div>

          ${renderCalendarFeedsList()}
          ${renderCalendarFeedForm()}
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
        ${syncStatus ? `<p class="calendar-feed-status">Sidste sync: ${escapeHtml(syncStatus)}</p>` : ''}
        ${importStatus ? `
          <p class="calendar-feed-status ${escapeHtml(importStatus.type || '')}">
            <span>${escapeHtml(importStatus.text)}</span>
            ${importStatus.dateText ? `<span>${escapeHtml(importStatus.dateText)}</span>` : ''}
            ${importStatus.feedId ? `<button class="calendar-feed-next-button" type="button" data-go-to-imported-calendar-feed="${escapeHtml(importStatus.feedId)}">G&aring; til n&aelig;ste aftale</button>` : ''}
          </p>
        ` : ''}
      </div>
      <div class="calendar-feed-actions">
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

function getCalendarFeedSyncStatus(feed) {
  return String(
    feed.last_sync_status
      || feed.sync_status
      || feed.last_status
      || '',
  ).trim()
}

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
    <div class="person-settings-row" data-person-row="${escapeHtml(rowId)}">
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
      <span class="person-settings-swatch" style="background:${escapeHtml(color)}" data-person-color-swatch="${escapeHtml(rowId)}"></span>
      ${isNew ? '' : `<button class="btn small" type="button" data-save-person="${escapeHtml(rowId)}">Gem</button>`}
    </div>
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
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (data?.session) await applySession(data.session)
    else { message = 'Bruger oprettet. Tjek din email for bekræftelse.'; render() }
  } catch (error) { message = 'Login kunne ikke gennemføres: ' + error.message; render() }
  finally { authRequestInFlight = false; form.querySelectorAll('button').forEach(button => { button.disabled = false }) }
}

async function handleLogout() {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) { message = 'Kunne ikke logge ud: ' + error.message; render(); return }
  clearSessionState()
  render()
}

async function loadHouseholds() {
  const epoch = sessionEpoch, userId = session?.user.id
  if (!userId) return
  const [result, memberships] = await Promise.all([
    supabase.from('households').select('*').order('created_at').order('id'),
    supabase.from('household_members').select('household_id,role').eq('user_id', userId),
  ])
  if (epoch !== sessionEpoch) return
  const error = result.error || memberships.error
  householdsLoadFailed = Boolean(error)
  if (error) { households = []; activeHousehold = null; message = 'Kunne ikke hente familie: ' + error.message; return }
  const roles = new Map((memberships.data || []).map(row => [row.household_id, row.role]))
  households = (result.data || []).map(row => ({ ...row, memberRole: roles.get(row.id) }))
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
    message = `Kunne ikke oprette household: ${error.message}`
    render()
    return
  }

  form.reset()
  await loadHouseholds()
  activeHousehold = findCreatedHousehold(data, previousIds, name) || households[0] || null
  householdRole = activeHousehold?.memberRole || null
  calendarItems = []
  calendarItemsHouseholdId = null
  householdPeople = []
  householdPeopleHouseholdId = null
  calendarFeeds = []
  calendarFeedsHouseholdId = null
  activePersonFilter = 'Alle'
  message = ''
  render()
}

async function loadCalendarItems({ renderAfter = false } = {}) {
  if (!activeHousehold) {
    return
  }

  const householdId = getHouseholdId(activeHousehold)
  const epoch = sessionEpoch, loadVersion = ++calendarLoadVersion
  isLoadingCalendar = true
  calendarItemsHouseholdId = householdId

  const { data, error } = await readAllRows(() => supabase
    .from('calendar_items')
    .select('*')
    .eq('household_id', householdId)
    .order('date', { ascending: true })
    .order('time', { ascending: true })
    .order('id'), () => epoch === sessionEpoch && activeHousehold?.id === householdId)

  if (epoch !== sessionEpoch || activeHousehold?.id !== householdId || loadVersion !== calendarLoadVersion) return
  isLoadingCalendar = false

  if (error) {
    calendarItems = []
    message = `Kunne ikke hente kalender-items: ${error.message}`
  } else {
    calendarItems = data || []
  }

  if (renderAfter && activeHousehold && getHouseholdId(activeHousehold) === householdId) {
    render({ preserveDialogs: true })
  }
}

async function loadHouseholdPeople({ renderAfter = false } = {}) {
  if (!activeHousehold) return
  const householdId = getHouseholdId(activeHousehold), epoch = sessionEpoch
  const loadVersion = ++peopleLoadVersion
  isLoadingPeople = true; householdPeopleHouseholdId = householdId
  const { data, error } = await supabase.from('household_people').select('*').eq('household_id', householdId).order('sort_order').order('name')
  const people = error ? [] : await resolveAvatarUrls(supabase, data || [])
  if (epoch !== sessionEpoch || activeHousehold?.id !== householdId || loadVersion !== peopleLoadVersion) return
  isLoadingPeople = false
  if (error) settingsMessage = 'Kunne ikke hente personer: ' + error.message
  householdPeople = people.map(person => ({ ...person, role: mapPersonRoleToUi(person.role) }))
  syncActivePersonFilter()
  if (renderAfter) render({ preserveDialogs: true })
}

async function loadCalendarFeeds({ renderAfter = false } = {}) {
  if (!activeHousehold) return
  const householdId = getHouseholdId(activeHousehold), epoch = sessionEpoch
  const loadVersion = ++feedsLoadVersion
  calendarFeedsHouseholdId = householdId
  if (!canManageFeeds()) { calendarFeeds = []; return }
  isLoadingCalendarFeeds = true
  const { data, error } = await supabase.from('calendar_feeds').select('*').eq('household_id', householdId).order('name')
  if (epoch !== sessionEpoch || activeHousehold?.id !== householdId || loadVersion !== feedsLoadVersion) return
  isLoadingCalendarFeeds = false
  calendarFeeds = data || []
  if (error) calendarImportMessage = 'Kunne ikke hente feeds: ' + error.message
  if (renderAfter) render({ preserveDialogs: true })
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
  if (!itemData.title || !itemData.date) return
  isCreatingCalendarItem = true
  const button = form.querySelector('button[type=submit]'); button.disabled = true
  const result = await runCalendarMutation(() => editingItem
    ? planEdit(editingRowsSnapshot, editingItem, itemData, scope)
    : planCreate(itemData))
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
async function runCalendarMutation(makePlan) {
  try {
    const plan = makePlan()
    return await supabase.rpc('mutate_calendar', {
      p_household_id: getHouseholdId(activeHousehold), p_expected: plan.expected, p_delete_ids: plan.deleteIds,
      p_upserts: plan.upserts.map(({id,values}) => ({id,...calendarPayload(values, householdPeople)})),
    })
  } catch (error) { return { error } }
}

async function toggleCalendarItemDone(itemId, done) {
  const item = findRenderableCalendarItem(itemId)
  if (!item || imported(item)) return
  const { error } = await runCalendarMutation(() => planEdit(calendarItems, item, {...itemValues(item), done}, 'one'))
  if (error) message = 'Kunne ikke gemme udført-status: ' + error.message
  await loadCalendarItems()
  render({ preserveDialogs: true })
}

async function handleDeleteCalendarItem() {
  const item = getEditingCalendarItem()
  if (!item || isCreatingCalendarItem || imported(item) || item.isVirtualMilestone) return
  const form = document.querySelector('#calendar-modal-form'), scope = String(new FormData(form).get('repeatScope') || 'one')
  isCreatingCalendarItem = true
  const button = document.querySelector('#calendar-modal-delete'); button.disabled = true
  const { error } = await runCalendarMutation(() => planDelete(editingRowsSnapshot, item, scope))
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
  isCreatingPerson = false
  await loadHouseholdPeople()
  settingsMessage = errors.length ? 'Kunne ikke gemme alle personer: ' + errors.join(', ') : 'Personer gemt.'
  render()
}

async function handleSavePersonRow(personId) {
  if (isCreatingPerson || !activeHousehold) return
  const existing = householdPeople.find(person => person.id === personId)
  if (!existing) return
  const values = getPersonRowValues(personId)
  if (!values.name) { settingsMessage = 'Personen mangler navn.'; render(); return }
  const epoch = sessionEpoch
  isCreatingPerson = true; settingsMessage = 'Gemmer person...'; render()
  const { error } = await savePerson(supabase, getHouseholdId(activeHousehold), values, { existing, file: pendingAvatarFiles.get(personId) })
  if (epoch !== sessionEpoch) return
  isCreatingPerson = false
  if (!error) pendingAvatarFiles.delete(personId)
  await loadHouseholdPeople()
  settingsMessage = error ? 'Kunne ikke gemme person: ' + error.message : 'Person gemt.'
  render()
}

function getPersonRowValues(rowId) {
  const prefix = `person-${rowId}`

  return {
    name: getInputValue(`${prefix}-name`),
    role: mapPersonRoleForDb(getInputValue(`${prefix}-role`)),
    color: getInputValue(`${prefix}-color`) || '#64748b',
    avatar_url: getAvatarValue(rowId),
  }
}

function getNewPersonFormValues(form) {
  const formData = new FormData(form)

  return {
    name: String(formData.get('name') || formData.get('new-name') || '').trim(),
    role: mapPersonRoleForDb(formData.get('role') || formData.get('new-role') || 'andet'),
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

function openCreateCalendarModal(date = null) {
  editingCalendarItemId = null; editingCalendarSnapshot = null; editingRowsSnapshot = []
  newCalendarDate = date || toDateIso(calendarCursorDate)
  isCalendarModalOpen = true; message = ''
  render()
}

function openEditCalendarModal(itemId) {
  const item = findRenderableCalendarItem(itemId)
  if (!item) return
  editingCalendarItemId = itemId
  editingCalendarSnapshot = structuredClone(item)
  editingRowsSnapshot = structuredClone(calendarItems)
  isCalendarModalOpen = true; message = ''
  render()
}

function closeCalendarModal() {
  isCalendarModalOpen = false
  editingCalendarItemId = null
  render()
}

function openSettingsModal() {
  isSettingsModalOpen = true
  settingsMessage = ''
  calendarImportMessage = ''
  render()
}

function closeSettingsModal() {
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
  const nextDate = new Date(calendarCursorDate)
  nextDate.setDate(nextDate.getDate() + (calendarViewMode === 'week' ? direction * 7 : direction))
  calendarCursorDate = nextDate
  render()
}

function toggleCalendarViewMode() {
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

  const readOnly = imported(getEditingCalendarItem()) || getEditingCalendarItem()?.isVirtualMilestone
  if (readOnly) return
  const titleInput = document.querySelector('#calendar-title')
  if (isTask) titleInput?.setAttribute('list', 'task-suggestions'); else titleInput?.removeAttribute('list')
  birthdayFields?.classList.toggle('hidden', !isBirthday)
  calendarOptions?.classList.toggle('hidden', isBirthday)
  setCheckboxOptionEnabled(repeatWeeklyOption, !isBirthday)
  setCheckboxOptionEnabled(weekdaysOption, canUseWeekdays)
  setCheckboxOptionEnabled(doneOption, isTask)
  updateModalScopeFields()
}

function updateModalScopeFields() {
  const item = getEditingCalendarItem()
  if (!item || imported(item) || item.isVirtualMilestone || !repeatContext(item)) return
  const form = document.querySelector('#calendar-modal-form'), scope = form?.querySelector('[name=repeatScope]:checked')?.value || 'one'
  const base = baseFor(editingRowsSnapshot, item), input = form.querySelector('#calendar-date'), weeklyInput = form.querySelector('[name=repeatWeekly]')
  const previousScope = input.dataset.scope
  if (previousScope !== scope) input.value = scope === 'series' ? base.date : scope === 'future' ? item.occurrenceDate : item.date
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
  if (hasUserSelectedCalendarView) {
    return
  }

  calendarViewMode = getDefaultCalendarViewMode()
}

function getCalendarHeaderLabel() {
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

function getRenderableCalendarItems() { return materialize(calendarItems, getVisibleCalendarDates()) }

function getVisibleCalendarDates() {
  if (calendarViewMode === 'day') {
    return [toDateIso(calendarCursorDate)]
  }

  return getVisibleWeekDays().map(toDateIso)
}

function findRenderableCalendarItem(itemId) {
  return getRenderableCalendarItems().find((item) => String(item.id) === String(itemId)) || null
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

init()
