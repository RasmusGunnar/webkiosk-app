import './style.css'
import { supabase } from './lib/supabase'

const app = document.querySelector('#app')

let session = null
let households = []
let activeHousehold = null
let calendarItems = []
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

async function init() {
  const { data, error } = await supabase.auth.getSession()

  if (error) {
    message = `Kunne ikke hente session: ${error.message}`
  }

  session = data?.session || null

  if (session) {
    await loadHouseholds()
    chooseDefaultHousehold()
  }

  render()
}

function render() {
  if (!session) {
    renderLogin()
    return
  }

  if (activeHousehold) {
    renderDashboard()
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

function renderDashboard() {
  syncDefaultCalendarViewMode()

  const householdId = getHouseholdId(activeHousehold)
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
          <p>Kalender, opgaver og aftaler for denne uge</p>
        </div>
        <button id="logout-button" class="logout-button" type="button">Log ud</button>
      </header>

      ${renderPersonChips()}

      <section class="calendar-section">
        <div class="section-heading calendar-heading">
          <div>
            <h2>Kalender</h2>
            <p>${escapeHtml(getCalendarHeaderLabel())}</p>
          </div>
          <div class="calendar-toolbar">
            <div class="calendar-nav">
              <button id="calendar-prev-button" type="button">Forrige ${navUnit}</button>
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
  document.querySelector('#new-calendar-button').addEventListener('click', openCreateCalendarModal)
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
  })

  const modalForm = document.querySelector('#calendar-modal-form')
  const modalBackdrop = document.querySelector('#calendar-modal')
  const settingsForm = document.querySelector('#people-settings-form')
  const calendarFeedForm = document.querySelector('#calendar-feed-form')
  const settingsBackdrop = document.querySelector('#settings-modal')

  if (modalForm) {
    modalForm.addEventListener('submit', handleSaveCalendarItem)
    document.querySelector('#calendar-modal-close').addEventListener('click', closeCalendarModal)
    document.querySelector('#calendar-modal-cancel').addEventListener('click', closeCalendarModal)
    document.querySelector('#calendar-modal-delete')?.addEventListener('click', handleDeleteCalendarItem)
    document.querySelector('#calendar-type').addEventListener('change', updateModalTypeFields)
    document.querySelectorAll('[data-calendar-person-choice]').forEach((input) => {
      input.addEventListener('change', handleCalendarPersonChoice)
    })
    updateModalTypeFields()
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (event) => {
      if (event.target === modalBackdrop) {
        closeCalendarModal()
      }
    })
  }

  if (settingsForm) {
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

  document.querySelectorAll('[data-person-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      activePersonFilter = button.dataset.personFilter || 'Alle'
      render()
    })
  })

  if (settingsBackdrop) {
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
  const people = [{ name: 'Alle', color: '#0f172a', avatar_url: '' }, ...householdPeople.filter(isActiveHouseholdPerson)]

  return `
    <div class="person-chipbar" aria-label="Personfilter">
      ${people.map((person) => {
        const name = person.name || 'Alle'
        const active = activePersonFilter === name
        const color = person.color || getPersonColor(name)

        return `
          <button
            class="person-chip ${active ? 'active' : ''}"
            type="button"
            data-person-filter="${escapeHtml(name)}"
            style="border-color:${escapeHtml(color)}"
          >
            ${renderPersonAvatar(person, 'person-chip-avatar')}
            <span>${escapeHtml(name)}</span>
          </button>
        `
      }).join('')}
    </div>
  `
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
    <article class="day-card">
      <header class="day-card-header">
        <strong>${escapeHtml(formatWeekday(date))}</strong>
        <span>${escapeHtml(formatShortDate(date))}</span>
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
  const doneControl = type === 'Opgave'
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
      data-calendar-item="${escapeHtml(id)}"
      style="border-left-color:${escapeHtml(getCalendarItemColor(item))}"
    >
      <div class="calendar-item-layout">
        ${iconColumn}
        <div class="calendar-item-content">
          <div class="calendar-item-title-row">
            <strong>${escapeHtml(title)}</strong>
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

  if (Boolean(getCalendarValue(item, 'repeatWeekly')) || item.isRepeatOccurrence) {
    labels.push('↻ uge')
  }

  if (getCalendarValue(item, 'overrideOf')) {
    labels.push('tilpasset')
  }

  return labels.map((label) => `<span class="calendar-repeat-label">${escapeHtml(label)}</span>`).join('')
}

function getCalendarItemTitle(item) {
  const title = getCalendarValue(item, 'title') || '(uden titel)'
  const birthYear = parseOptionalNumber(getCalendarValue(item, 'birthYear'))
  const date = new Date(getCalendarValue(item, 'date'))

  if (!isBirthdayItem(item) || !birthYear || Number.isNaN(date.getTime())) {
    return title
  }

  const age = date.getFullYear() - birthYear
  return age > 0 ? `${title} bliver ${age} år` : title
}

function renderCalendarModalOld() {
  if (!isCalendarModalOpen) {
    return ''
  }

  const item = getEditingCalendarItem()
  const mode = item ? 'Rediger kalender-item' : 'Nyt kalender-item'
  const submitText = item ? 'Gem ændringer' : 'Opret kalender-item'
  const values = {
    title: getCalendarValue(item || {}, 'title'),
    date: getCalendarValue(item || {}, 'date') || getDefaultCalendarItemDate(),
    time: getCalendarValue(item || {}, 'time'),
    person: getPrimaryCalendarPerson(item || {}),
    type: getCalendarValue(item || {}, 'type') || 'Aktivitet',
    durationMin: getCalendarValue(item || {}, 'durationMin'),
    location: getCalendarValue(item || {}, 'location'),
    note: getCalendarValue(item || {}, 'note'),
    repeatWeekly: Boolean(getCalendarValue(item || {}, 'repeatWeekly')),
    repeatYearly: Boolean(getCalendarValue(item || {}, 'repeatYearly')),
    repeatUntil: getCalendarValue(item || {}, 'repeatUntil'),
  }

  return `
    <div id="calendar-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calendar-modal-title">
      <div class="calendar-modal">
        <header class="modal-header">
          <h2 id="calendar-modal-title">${mode}</h2>
          <button id="calendar-modal-close" class="icon-button" type="button" aria-label="Luk">×</button>
        </header>

        <form id="calendar-modal-form">
          <div class="form-grid">
            <div class="full">
              <label for="calendar-title">Titel</label>
              <input id="calendar-title" name="title" type="text" value="${escapeHtml(values.title)}" required />
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

            <div class="full">
              <label for="calendar-note">Note</label>
              <textarea id="calendar-note" name="note">${escapeHtml(values.note)}</textarea>
            </div>
          </div>

          <footer class="modal-actions">
            <button id="calendar-modal-cancel" type="button">Annuller</button>
            <button type="submit">${submitText}</button>
          </footer>
        </form>
      </div>
    </div>
  `
}

function renderCalendarModalUnused() {
  if (!isCalendarModalOpen) {
    return ''
  }

  const item = getEditingCalendarItem()
  const mode = item ? 'Rediger kalender-item' : 'Nyt kalender-item'
  const submitText = item ? 'Gem ændringer' : 'Opret kalender-item'
  const values = {
    title: getCalendarValue(item || {}, 'title'),
    date: getCalendarValue(item || {}, 'date') || getDefaultCalendarItemDate(),
    time: getCalendarValue(item || {}, 'time'),
    person: getPrimaryCalendarPerson(item || {}),
    type: getCalendarValue(item || {}, 'type') || 'Aktivitet',
    durationMin: getCalendarValue(item || {}, 'durationMin'),
    location: getCalendarValue(item || {}, 'location'),
    note: getCalendarValue(item || {}, 'note'),
    repeatWeekly: Boolean(getCalendarValue(item || {}, 'repeatWeekly')),
    repeatYearly: Boolean(getCalendarValue(item || {}, 'repeatYearly')),
    repeatUntil: getCalendarValue(item || {}, 'repeatUntil'),
  }

  return `
    <div id="calendar-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calendar-modal-title">
      <div class="calendar-modal">
        <header class="modal-header">
          <h2 id="calendar-modal-title">${mode}</h2>
          <button id="calendar-modal-close" class="icon-button" type="button" aria-label="Luk">×</button>
        </header>

        <form id="calendar-modal-form">
          <div class="form-grid">
            <div class="full">
              <label for="calendar-title">Titel</label>
              <input id="calendar-title" name="title" type="text" value="${escapeHtml(values.title)}" required />
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
                ${renderTypeOption('Fritidsinteresse', values.type)}
                ${renderTypeOption('Opgave', values.type)}
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

            <div class="full">
              <label for="calendar-note">Note</label>
              <textarea id="calendar-note" name="note">${escapeHtml(values.note)}</textarea>
            </div>

            <div id="calendar-options" class="full repeat-options ${isBirthday ? 'hidden' : ''}">
              <label class="checkbox-label">
                <input name="repeatWeekly" type="checkbox" ${values.repeatWeekly ? 'checked' : ''} />
                Gentag ugentligt
              </label>
              <label class="checkbox-label">
                <input name="repeatYearly" type="checkbox" ${values.repeatYearly ? 'checked' : ''} />
                Gentag årligt
              </label>
              <div>
                <label for="calendar-repeat-until">Gentag indtil</label>
                <input id="calendar-repeat-until" name="repeatUntil" type="date" value="${escapeHtml(values.repeatUntil)}" />
              </div>
            </div>
          </div>

          <footer class="modal-actions">
            <button id="calendar-modal-cancel" type="button">Annuller</button>
            <button type="submit">${submitText}</button>
          </footer>
        </form>
      </div>
    </div>
  `
}

function renderCalendarModal() {
  if (!isCalendarModalOpen) {
    return ''
  }

  const item = getEditingCalendarItem()
  const mode = item ? 'Rediger kalender-item' : 'Nyt kalender-item'
  const submitText = item ? 'Gem ændringer' : 'Opret kalender-item'
  const values = {
    title: getCalendarValue(item || {}, 'title'),
    date: getCalendarValue(item || {}, 'date') || getDefaultCalendarItemDate(),
    time: getCalendarValue(item || {}, 'time'),
    people: getCalendarItemPeople(item || {}),
    type: normalizeTypeValue(getCalendarValue(item || {}, 'type') || 'Aktivitet'),
    durationMin: getCalendarValue(item || {}, 'durationMin'),
    location: getCalendarValue(item || {}, 'location'),
    note: getCalendarValue(item || {}, 'note'),
    done: Boolean(getCalendarValue(item || {}, 'done')),
    repeatWeekly: Boolean(getCalendarValue(item || {}, 'repeatWeekly')),
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
          <div class="form-grid">
            <div class="full">
              <label for="calendar-title">Titel</label>
              <input id="calendar-title" name="title" type="text" value="${escapeHtml(values.title)}" required />
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

            <div id="calendar-options" class="full repeat-options ${isBirthday ? 'hidden' : ''}">
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
                <label>Ã†ndring skal gÃ¦lde for</label>
                <div class="repeat-scope-row">
                  <label class="checkbox-label"><input type="radio" name="repeatScope" value="one" /> Kun denne</label>
                  <label class="checkbox-label"><input type="radio" name="repeatScope" value="future" /> Denne og frem</label>
                  <label class="checkbox-label"><input type="radio" name="repeatScope" value="series" checked /> Hele serien</label>
                </div>
              </div>
            ` : ''}
          </div>

          <footer class="modal-actions">
            ${item ? '<button id="calendar-modal-delete" class="danger-button" type="button">Slet</button>' : ''}
            <button id="calendar-modal-cancel" type="button">Annuller</button>
            <button type="submit">${submitText}</button>
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
                <input id="person-avatar-file" name="avatar_file" type="file" accept="image/*" data-person-avatar-file="new" />
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
            <button id="add-calendar-feed-button" class="btn small" type="button">+ Tilf&oslash;j feed</button>
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
  const assignedPerson = feed.assigned_person_name || 'Ingen'
  const source = getCalendarFeedSourceLabel(feed.source)
  const isActive = feed.is_active !== false
  const syncStatus = getCalendarFeedSyncStatus(feed)
  const feedUrl = feed.feed_url || ''
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
        <button type="button" data-import-calendar-feed="${escapeHtml(String(feed.id))}" ${isImporting ? 'disabled' : ''}>${isImporting ? 'Henter...' : 'Hent nu'}</button>
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
          <select id="calendar-feed-person" name="assigned_person_name" data-calendar-feed-field>
            ${renderCalendarFeedPersonOptions(calendarFeedDraft.assigned_person_name)}
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
  const selected = String(currentPerson || '')
  const names = ['', 'Alle']

  householdPeople.filter(isActiveHouseholdPerson).forEach((person) => {
    const name = String(person.name || '').trim()
    if (name && !names.some((item) => item.toLowerCase() === name.toLowerCase())) {
      names.push(name)
    }
  })

  if (selected && !names.some((name) => name.toLowerCase() === selected.toLowerCase())) {
    names.push(selected)
  }

  return names.map((name) => {
    const label = name || 'Ingen'

    return `
      <option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>
        ${escapeHtml(label)}
      </option>
    `
  }).join('')
}

function createEmptyCalendarFeedDraft() {
  return {
    source: 'aula',
    feed_url: '',
    assigned_person_name: '',
    is_active: true,
  }
}

function createCalendarFeedDraft(feed) {
  return {
    source: normalizeCalendarFeedSource(feed.source),
    feed_url: String(feed.feed_url || ''),
    assigned_person_name: String(feed.assigned_person_name || ''),
    is_active: feed.is_active !== false,
  }
}

function getCalendarFeedDraftValues() {
  const source = normalizeCalendarFeedSource(calendarFeedDraft.source)
  const assignedPersonName = String(calendarFeedDraft.assigned_person_name || '').trim()

  return {
    source,
    name: buildCalendarFeedName(source, assignedPersonName),
    feed_url: String(calendarFeedDraft.feed_url || '').trim(),
    assigned_person_name: assignedPersonName || null,
    is_active: !!calendarFeedDraft.is_active,
  }
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

function getCalendarItemImportFeedId(item) {
  const values = [
    item.calendar_id,
    item.calendarId,
    item.feed_id,
    item.feedId,
    item.data?.calendar_id,
    item.data?.calendarId,
    item.data?.feed_id,
    item.data?.feedId,
  ]

  const value = values.find((candidate) => candidate !== undefined && candidate !== null && String(candidate).trim())
  return value === undefined ? '' : String(value)
}

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
  const avatar = person.avatar_url || ''

  return `
    <div class="person-settings-row" data-person-row="${escapeHtml(rowId)}">
      <div class="person-avatar-preview" data-avatar-preview="${escapeHtml(rowId)}">
        ${renderPersonAvatar({ name, color, avatar_url: avatar }, 'person-settings-avatar')}
      </div>
      <input type="hidden" name="${prefix}-avatar" value="${escapeHtml(avatar)}" data-person-avatar-value="${escapeHtml(rowId)}" />
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
        <input id="${prefix}-avatar-file" name="${prefix}-avatar-file" type="file" accept="image/*" data-person-avatar-file="${escapeHtml(rowId)}" />
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
  const avatar = person.avatar_url || ''
  const color = person.color || getPersonColor(name)
  const initial = (name.trim()[0] || '?').toUpperCase()

  if (avatar) {
    return `<span class="${className}"><img src="${escapeHtml(avatar)}" alt="" /></span>`
  }

  return `<span class="${className}" style="background:${escapeHtml(color)}22;color:#111827">${escapeHtml(initial)}</span>`
}

async function handleLogin(event) {
  event.preventDefault()

  const messageElement = document.querySelector('#message')
  const formData = new FormData(event.target)
  const email = String(formData.get('email')).trim()
  const password = String(formData.get('password'))
  const action = event.submitter?.value === 'signup' ? 'signup' : 'login'

  messageElement.textContent = action === 'signup' ? 'Opretter bruger...' : 'Logger ind...'

  const { data, error } = action === 'signup'
    ? await supabase.auth.signUp({ email, password })
    : await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    message = action === 'signup'
      ? `Kunne ikke oprette bruger: ${error.message}`
      : `Kunne ikke logge ind: ${error.message}`
    messageElement.textContent = message
    return
  }

  session = data?.session || (await supabase.auth.getSession()).data?.session || null

  if (!session) {
    message = 'Bruger oprettet. Tjek din email, hvis Supabase kræver bekræftelse.'
    render()
    return
  }

  await loadHouseholds()
  chooseDefaultHousehold()
  message = ''
  render()
}

async function handleLogout() {
  await supabase.auth.signOut()
  session = null
  households = []
  activeHousehold = null
  calendarItems = []
  calendarItemsHouseholdId = null
  householdPeople = []
  householdPeopleHouseholdId = null
  calendarFeeds = []
  calendarFeedsHouseholdId = null
  activePersonFilter = 'Alle'
  isCalendarModalOpen = false
  editingCalendarItemId = null
  isSettingsModalOpen = false
  isCreatingPerson = false
  settingsMessage = ''
  calendarImportMessage = ''
  importingCalendarFeedId = null
  calendarFeedImportMessages = {}
  editingCalendarFeedId = null
  calendarFeedDraft = createEmptyCalendarFeedDraft()
  calendarViewMode = getDefaultCalendarViewMode()
  calendarCursorDate = new Date()
  hasUserSelectedCalendarView = false
  message = ''
  render()
}

async function loadHouseholds() {
  const { data, error } = await supabase
    .from('households')
    .select('*')

  if (error) {
    households = []
    activeHousehold = null
    message = `Kunne ikke hente households: ${error.message}`
    return
  }

  households = data || []
}

function chooseDefaultHousehold() {
  activeHousehold = households[0] || null
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
  isLoadingCalendar = true
  calendarItemsHouseholdId = householdId

  const { data, error } = await supabase
    .from('calendar_items')
    .select('*')
    .eq('household_id', householdId)
    .order('date', { ascending: true })
    .order('time', { ascending: true })

  isLoadingCalendar = false

  if (error) {
    calendarItems = []
    message = `Kunne ikke hente kalender-items: ${error.message}`
  } else {
    calendarItems = data || []
  }

  if (renderAfter && activeHousehold && getHouseholdId(activeHousehold) === householdId) {
    render()
  }
}

async function loadHouseholdPeople({ renderAfter = false } = {}) {
  if (!activeHousehold) {
    return
  }

  const householdId = getHouseholdId(activeHousehold)
  isLoadingPeople = true
  householdPeopleHouseholdId = householdId

  const { data, error } = await supabase
    .from('household_people')
    .select('*')
    .eq('household_id', householdId)
    .order('name', { ascending: true })

  isLoadingPeople = false

  if (error) {
    householdPeople = []
    settingsMessage = `Kunne ikke hente personer: ${error.message}`
  } else {
    householdPeople = (data || []).map((person) => ({
      ...person,
      role: mapPersonRoleToUi(person.role),
    }))
    syncActivePersonFilter()
  }

  if (renderAfter && activeHousehold && getHouseholdId(activeHousehold) === householdId) {
    render()
  }
}

async function loadCalendarFeeds({ renderAfter = false } = {}) {
  if (!activeHousehold) {
    return
  }

  const householdId = getHouseholdId(activeHousehold)
  isLoadingCalendarFeeds = true
  calendarFeedsHouseholdId = householdId

  const { data, error } = await supabase
    .from('calendar_feeds')
    .select('*')
    .eq('household_id', householdId)
    .order('name', { ascending: true })

  isLoadingCalendarFeeds = false

  if (error) {
    calendarFeeds = []
    calendarImportMessage = `Kunne ikke hente feeds: ${error.message}`
  } else {
    calendarFeeds = data || []
  }

  if (renderAfter && activeHousehold && getHouseholdId(activeHousehold) === householdId) {
    render()
  }
}

async function handleSaveCalendarItem(event) {
  event.preventDefault()

  if (isCreatingCalendarItem || !activeHousehold) {
    return
  }

  const form = event.target
  const submitButton = form.querySelector('button[type="submit"]')
  const formData = new FormData(form)
  const householdId = getHouseholdId(activeHousehold)
  const editingItem = getEditingCalendarItem()
  const type = normalizeTypeValue(String(formData.get('type')).trim() || 'Aktivitet')
  const isBirthday = type === 'Fødselsdag'
  const isTask = type === 'Opgave'
  const isMilestone = type === 'Mærkedag'
  const selectedPeople = getSelectedCalendarPeople(formData)
  const selectedPerson = selectedPeople[0] || 'Alle'
  const itemData = {
    household_id: householdId,
    title: String(formData.get('title')).trim(),
    date: String(formData.get('date')).trim(),
    time: String(formData.get('time')).trim(),
    person: selectedPerson,
    people: selectedPeople,
    type,
    durationMin: parseOptionalNumber(formData.get('durationMin')),
    location: String(formData.get('location')).trim(),
    note: String(formData.get('note')).trim(),
    done: isTask ? formData.has('done') : false,
    repeatWeekly: isBirthday ? false : formData.has('repeatWeekly'),
    weekdays: editingItem || isBirthday || isMilestone ? false : formData.has('weekdays'),
    exceptions: [],
    repeatUntil: '',
    seriesId: '',
    repeatYearly: isBirthday,
    birthYear: isBirthday ? String(formData.get('birthYear')).trim() : '',
  }

  if (!itemData.title || !itemData.date) {
    return
  }

  isCreatingCalendarItem = true
  submitButton.disabled = true
  submitButton.textContent = editingItem ? 'Gemmer...' : 'Opretter...'
  message = editingItem ? 'Gemmer kalender-item...' : 'Opretter kalender-item...'

  const { error } = editingItem
    ? await saveExistingCalendarItem(editingItem, itemData, formData)
    : await saveNewCalendarItem(itemData)

  isCreatingCalendarItem = false

  if (error) {
    message = editingItem
      ? `Kunne ikke opdatere kalender-item: ${error.message}`
      : `Kunne ikke oprette kalender-item: ${error.message}`
    render()
    return
  }

  isCalendarModalOpen = false
  editingCalendarItemId = null
  message = editingItem ? 'Kalender-item opdateret.' : 'Kalender-item oprettet.'
  await loadCalendarItems()
  render()
}

async function saveNewCalendarItem(itemData) {
  if (itemData.weekdays) {
    return createWeekdayCalendarItems(itemData)
  }

  return createCalendarItem(itemData)
}

async function saveExistingCalendarItem(item, itemData, formData) {
  if (isRepeatContextItem(item)) {
    return updateRepeatCalendarItem(item, itemData, getRepeatScope(formData))
  }

  return updateCalendarItem(item, itemData)
}

async function createWeekdayCalendarItems(itemData) {
  const dates = getWeekdayDates(itemData.date)

  for (const date of dates) {
    const { error } = await createCalendarItem({
      ...itemData,
      date,
      repeatWeekly: false,
      weekdays: false,
      repeatUntil: '',
      exceptions: [],
      seriesId: '',
    })

    if (error) {
      return { error }
    }
  }

  return { error: null }
}

async function createCalendarItem(itemData) {
  const payload = {
    ...itemData,
    done: Boolean(itemData.done),
    created_by: session.user.id,
  }

  const { data, error } = await supabase
    .from('calendar_items')
    .insert({
      household_id: payload.household_id,
      title: payload.title,
      date: payload.date,
      time: payload.time,
      person: payload.person,
      type: payload.type,
      note: payload.note,
      done: payload.done,
      created_by: payload.created_by,
      data: { ...payload },
    })
    .select('id,data')
    .single()

  if (error || !data?.id || !payload.repeatWeekly) {
    return { data, error }
  }

  const nextData = {
    ...(data.data || {}),
    ...payload,
    seriesId: data.id,
    exceptions: [],
    repeatUntil: '',
  }

  const { error: updateError } = await supabase
    .from('calendar_items')
    .update({ data: nextData })
    .eq('id', data.id)

  return { data, error: updateError }
}

async function updateCalendarItem(item, itemData) {
  const storedItem = getStoredCalendarItem(item) || item
  const nextData = {
    ...(storedItem.data || {}),
    ...itemData,
    seriesId: itemData.seriesId ?? (itemData.repeatWeekly ? (getCalendarValue(storedItem, 'seriesId') || storedItem.id) : ''),
    exceptions: itemData.exceptions ?? (itemData.repeatWeekly ? getCalendarExceptions(storedItem) : []),
    repeatUntil: itemData.repeatUntil ?? (itemData.repeatWeekly ? getCalendarValue(storedItem, 'repeatUntil') : ''),
  }

  return supabase
    .from('calendar_items')
    .update({
      title: itemData.title,
      date: itemData.date,
      time: itemData.time,
      person: itemData.person,
      type: itemData.type,
      note: itemData.note,
      done: itemData.done,
      data: nextData,
    })
    .eq('id', storedItem.id)
}

async function updateRepeatCalendarItem(item, itemData, scope) {
  const baseItem = getRepeatBaseItem(item)

  if (!baseItem) {
    return updateCalendarItem(item, itemData)
  }

  if (isBaseOriginalOccurrence(item, baseItem)) {
    return updateCalendarItem(baseItem, itemData)
  }

  if (scope === 'one') {
    return updateOneRepeatOccurrence(baseItem, item, itemData)
  }

  if (scope === 'future') {
    return updateFutureRepeatOccurrences(baseItem, item, itemData)
  }

  return updateWholeRepeatSeries(baseItem, itemData)
}

async function updateWholeRepeatSeries(baseItem, itemData) {
  const seriesId = getCalendarSeriesId(baseItem)

  return updateCalendarItem(baseItem, {
    ...itemData,
    seriesId,
    exceptions: getCalendarExceptions(baseItem),
    repeatUntil: itemData.repeatWeekly ? getCalendarValue(baseItem, 'repeatUntil') : '',
  })
}

async function updateOneRepeatOccurrence(baseItem, item, itemData) {
  const occurrenceDate = getOccurrenceDate(item)
  const targetDate = toDateString(itemData.date) || occurrenceDate
  const seriesId = getCalendarSeriesId(baseItem)

  if (!item.isRepeatOccurrence || occurrenceDate === getCalendarValue(baseItem, 'date')) {
    return updateCalendarItem(baseItem, itemData)
  }

  const existingOverride = findRepeatOverride(seriesId, occurrenceDate) || findRepeatOverride(seriesId, targetDate)
  const exceptionResult = await addRepeatException(baseItem, occurrenceDate)

  if (exceptionResult.error) {
    return exceptionResult
  }

  if (existingOverride) {
    return updateCalendarItem(existingOverride, {
      ...itemData,
      repeatWeekly: false,
      repeatUntil: '',
      exceptions: [],
      seriesId,
      overrideOf: seriesId,
      overrideBaseId: baseItem.id,
    })
  }

  return createCalendarItem({
    ...buildOverrideItemData(baseItem, itemData),
    date: itemData.date || occurrenceDate,
    seriesId,
    overrideOf: seriesId,
    overrideBaseId: baseItem.id,
  })
}

async function updateFutureRepeatOccurrences(baseItem, item, itemData) {
  const occurrenceDate = getOccurrenceDate(item)
  const previousDate = addDaysIso(occurrenceDate, -1)
  const seriesId = getCalendarSeriesId(baseItem)
  const baseUpdate = await updateBaseRepeatData(baseItem, {
    repeatUntil: previousDate,
    exceptions: getCalendarExceptions(baseItem).filter((date) => date < occurrenceDate),
  })

  if (baseUpdate.error) {
    return baseUpdate
  }

  const deleteResult = await deleteFutureRepeatOverrides(seriesId, baseItem.id, occurrenceDate)

  if (deleteResult.error) {
    return deleteResult
  }

  return createCalendarItem({
    ...itemData,
    date: itemData.date || occurrenceDate,
    repeatWeekly: itemData.repeatWeekly,
    weekdays: false,
    exceptions: [],
    repeatUntil: '',
    seriesId: '',
    overrideOf: '',
    overrideBaseId: baseItem.id,
  })
}

async function toggleCalendarItemDone(itemId, done) {
  const item = findRenderableCalendarItem(itemId)

  if (!item) {
    return
  }

  const baseItem = getRepeatBaseItem(item)

  if (baseItem && isBaseOriginalOccurrence(item, baseItem)) {
    const result = await updateCalendarItem(baseItem, { ...calendarItemToData(item), done })

    if (result.error) {
      message = `Kunne ikke opdatere done-status: ${result.error.message}`
      render()
      return
    }

    await loadCalendarItems()
    render()
    return
  }

  if (isRepeatContextItem(item) && !getCalendarValue(item, 'overrideOf')) {
    const result = baseItem
      ? await updateOneRepeatOccurrence(baseItem, item, { ...calendarItemToData(item), done })
      : { error: null }

    if (result.error) {
      message = `Kunne ikke opdatere done-status: ${result.error.message}`
      render()
      return
    }

    await loadCalendarItems()
    render()
    return
  }

  const nextData = {
    ...(item.data || {}),
    done,
  }

  const { error } = await supabase
    .from('calendar_items')
    .update({
      done,
      data: nextData,
    })
    .eq('id', item.id)

  if (error) {
    message = `Kunne ikke opdatere done-status: ${error.message}`
    render()
    return
  }

  await loadCalendarItems()
  render()
}

async function handleDeleteCalendarItem() {
  const item = getEditingCalendarItem()

  if (!item || isCreatingCalendarItem) {
    return
  }

  const scope = getRepeatScope(new FormData(document.querySelector('#calendar-modal-form')))
  isCreatingCalendarItem = true
  message = 'Sletter kalender-item...'
  render()

  const { error } = isRepeatContextItem(item)
    ? await deleteRepeatCalendarItem(item, scope)
    : await deleteCalendarItemById(item.id)

  isCreatingCalendarItem = false

  if (error) {
    message = `Kunne ikke slette kalender-item: ${error.message}`
    render()
    return
  }

  isCalendarModalOpen = false
  editingCalendarItemId = null
  message = 'Kalender-item slettet.'
  await loadCalendarItems()
  render()
}

async function deleteRepeatCalendarItem(item, scope) {
  if (scope === 'series') {
    return deleteWholeRepeatSeries(item)
  }

  if (scope === 'future') {
    return deleteFutureRepeatOccurrences(item)
  }

  return deleteOneRepeatOccurrence(item)
}

async function deleteWholeRepeatSeries(item) {
  const baseItem = getRepeatBaseItem(item) || item
  const seriesId = getCalendarSeriesId(baseItem)
  const ids = calendarItems
    .filter((calendarItem) => isSameRepeatSeries(calendarItem, seriesId, baseItem.id))
    .map((calendarItem) => calendarItem.id)

  return deleteCalendarItemsByIds(ids)
}

async function deleteOneRepeatOccurrence(item) {
  const baseItem = getRepeatBaseItem(item)
  const occurrenceDate = getOccurrenceDate(item)

  if (!baseItem) {
    return deleteCalendarItemById(item.id)
  }

  const exceptionResult = await addRepeatException(baseItem, occurrenceDate)

  if (exceptionResult.error) {
    return exceptionResult
  }

  const override = findRepeatOverride(getCalendarSeriesId(baseItem), occurrenceDate)
  return override ? deleteCalendarItemById(override.id) : { error: null }
}

async function deleteFutureRepeatOccurrences(item) {
  const baseItem = getRepeatBaseItem(item)
  const occurrenceDate = getOccurrenceDate(item)

  if (!baseItem) {
    return deleteCalendarItemById(item.id)
  }

  const baseUpdate = await updateBaseRepeatData(baseItem, {
    repeatUntil: addDaysIso(occurrenceDate, -1),
    exceptions: getCalendarExceptions(baseItem).filter((date) => date < occurrenceDate),
  })

  if (baseUpdate.error) {
    return baseUpdate
  }

  return deleteFutureRepeatOverrides(getCalendarSeriesId(baseItem), baseItem.id, occurrenceDate)
}

async function deleteCalendarItemById(id) {
  return deleteCalendarItemsByIds([id])
}

async function deleteCalendarItemsByIds(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]

  if (!uniqueIds.length) {
    return { error: null }
  }

  const { error } = await supabase
    .from('calendar_items')
    .delete()
    .in('id', uniqueIds)

  return { error }
}

async function handleCreatePerson(event) {
  await handleSavePeopleSettings(event)
}

async function handleSavePeopleSettings(event) {
  event.preventDefault()

  if (isCreatingPerson || !activeHousehold) {
    return
  }

  const form = event.target
  const newPerson = getNewPersonFormValues(form)
  const personUpdates = householdPeople.map((person) => ({
    id: person.id,
    values: getPersonRowValues(String(person.id)),
  }))

  isCreatingPerson = true
  settingsMessage = 'Gemmer personer...'
  render()

  const saveErrors = []

  for (const person of personUpdates) {
    const values = person.values

    if (!values.name) {
      continue
    }

    const { error } = await supabase
      .from('household_people')
      .update(values)
      .eq('id', person.id)

    if (error) {
      saveErrors.push(error.message)
    }
  }

  if (newPerson.name) {
    const { error } = await supabase
      .from('household_people')
      .insert({
        household_id: getHouseholdId(activeHousehold),
        ...newPerson,
      })

    if (error) {
      saveErrors.push(error.message)
    }
  }

  isCreatingPerson = false

  if (saveErrors.length) {
    settingsMessage = `Kunne ikke gemme personer: ${saveErrors.join(', ')}`
    render()
    return
  }

  await loadHouseholdPeople()
  settingsMessage = newPerson.name ? 'Person oprettet.' : 'Personer gemt.'
  render()
}

async function handleSavePersonRow(personId) {
  if (isCreatingPerson || !activeHousehold || !personId) {
    return
  }

  const values = getPersonRowValues(String(personId))

  if (!values.name) {
    settingsMessage = 'Personen mangler navn.'
    render()
    return
  }

  isCreatingPerson = true
  settingsMessage = 'Gemmer person...'
  render()

  const { error } = await supabase
    .from('household_people')
    .update(values)
    .eq('id', personId)

  isCreatingPerson = false

  if (error) {
    settingsMessage = `Kunne ikke gemme person: ${error.message}`
    render()
    return
  }

  await loadHouseholdPeople()
  settingsMessage = 'Person gemt.'
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

function openCreateCalendarModal() {
  editingCalendarItemId = null
  isCalendarModalOpen = true
  message = ''
  render()
}

function openEditCalendarModal(itemId) {
  editingCalendarItemId = itemId
  isCalendarModalOpen = true
  message = ''
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

  if (!feed) {
    calendarImportMessage = 'Feed blev ikke fundet.'
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
    console.log('import-calendar-feed response', result)
  } catch (error) {
    console.log('import-calendar-feed thrown error', error)
    importingCalendarFeedId = null
    setCalendarFeedImportMessage(feed.id, `Fejl: ${formatErrorMessage(error?.message || error)}`, 'error')
    renderPreservingSettingsScroll()
    return
  }

  const { data, error } = result

  importingCalendarFeedId = null

  if (error) {
    console.log('import-calendar-feed invoke error', error)
    setCalendarFeedImportMessage(feed.id, `Fejl: ${await getEdgeFunctionErrorMessage(error)}`, 'error')
    renderPreservingSettingsScroll()
    return
  }

  if (data?.success === false) {
    console.log('import-calendar-feed data error', data)
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

  const values = getCalendarFeedDraftValues()

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
  render()
}

function getEditingCalendarItem() {
  if (!editingCalendarItemId) {
    return null
  }

  return findRenderableCalendarItem(editingCalendarItemId)
    || calendarItems.find((item) => String(item.id) === String(editingCalendarItemId))
    || null
}

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
  const selected = normalizeCalendarPeople(selectedPeople)
  const names = ['Alle']

  householdPeople.filter(isActiveHouseholdPerson).forEach((person) => {
    const name = normalizeCalendarPersonName(person.name)
    if (name !== 'Alle' && !names.some((item) => item.toLowerCase() === name.toLowerCase())) {
      names.push(name)
    }
  })

  selected.forEach((name) => {
    if (!names.some((item) => item.toLowerCase() === name.toLowerCase())) {
      names.push(name)
    }
  })

  return names.map((name) => {
    const checked = selected.some((selectedName) => selectedName.toLowerCase() === name.toLowerCase())
    const color = getPersonColor(name)

    return `
      <label class="calendar-person-pill ${checked ? 'selected' : ''}" style="--person-color:${escapeHtml(color)}">
        <input
          type="checkbox"
          name="people"
          value="${escapeHtml(name)}"
          data-calendar-person-choice
          ${checked ? 'checked' : ''}
        />
        <span>${escapeHtml(name)}</span>
      </label>
    `
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
  if (activePersonFilter === 'Alle') {
    return
  }

  const hasActiveFilterPerson = householdPeople
    .filter(isActiveHouseholdPerson)
    .some((person) => String(person.name || '').trim().toLowerCase() === activePersonFilter.toLowerCase())

  if (!hasActiveFilterPerson) {
    activePersonFilter = 'Alle'
  }
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

  birthdayFields?.classList.toggle('hidden', !isBirthday)
  calendarOptions?.classList.toggle('hidden', isBirthday)
  setCheckboxOptionEnabled(repeatWeeklyOption, !isBirthday)
  setCheckboxOptionEnabled(weekdaysOption, canUseWeekdays)
  setCheckboxOptionEnabled(doneOption, isTask)
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
    return 0
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
  return window.innerWidth < 700 ? 'day' : 'week'
}

function syncDefaultCalendarViewMode() {
  if (hasUserSelectedCalendarView) {
    return
  }

  calendarViewMode = getDefaultCalendarViewMode()
}

function getCalendarHeaderLabel() {
  return calendarViewMode === 'week' ? 'Denne uge' : formatDayHeaderDate(calendarCursorDate)
}

function getDefaultCalendarItemDate() {
  return toDateIso(calendarViewMode === 'day' ? calendarCursorDate : new Date())
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

function getRenderableCalendarItems() {
  const visibleDates = getVisibleCalendarDates()
  const visibleDateSet = new Set(visibleDates)
  const visibleItems = []
  const seenIds = new Set()

  calendarItems.forEach((item) => {
    const itemDate = getCalendarValue(item, 'date')

    if (visibleDateSet.has(itemDate)) {
      if (Boolean(getCalendarValue(item, 'repeatWeekly')) && !getCalendarValue(item, 'overrideOf')) {
        const repeatUntil = getCalendarValue(item, 'repeatUntil')
        const seriesId = getCalendarSeriesId(item)

        if (getCalendarExceptions(item).includes(itemDate) || findRepeatOverride(seriesId, itemDate) || (repeatUntil && itemDate > repeatUntil)) {
          return
        }
      }

      const visibleItem = addRepeatDisplayFields(item, itemDate)
      visibleItems.push(visibleItem)
      seenIds.add(String(visibleItem.id))
    }
  })

  calendarItems.forEach((item) => {
    if (!Boolean(getCalendarValue(item, 'repeatWeekly')) || getCalendarValue(item, 'overrideOf')) {
      return
    }

    const baseDate = getCalendarValue(item, 'date')
    const baseDateObject = parseDateIso(baseDate)

    if (!baseDateObject) {
      return
    }

    const baseDay = baseDateObject.getDay()
    const exceptions = new Set(getCalendarExceptions(item))
    const repeatUntil = getCalendarValue(item, 'repeatUntil')
    const seriesId = getCalendarSeriesId(item)

    visibleDates.forEach((dateIso) => {
      const date = parseDateIso(dateIso)

      if (!date || date.getDay() !== baseDay || dateIso <= baseDate) {
        return
      }

      if (repeatUntil && dateIso > repeatUntil) {
        return
      }

      if (exceptions.has(dateIso) || findRepeatOverride(seriesId, dateIso)) {
        return
      }

      const virtualItem = {
        ...item,
        id: `repeat|${item.id}|${dateIso}`,
        date: dateIso,
        isRepeatOccurrence: true,
        baseId: item.id,
        seriesId,
        occurrenceDate: dateIso,
      }

      if (!seenIds.has(String(virtualItem.id))) {
        visibleItems.push(virtualItem)
        seenIds.add(String(virtualItem.id))
      }
    })
  })

  return visibleItems.sort((a, b) => {
    const dateCompare = String(getCalendarValue(a, 'date')).localeCompare(String(getCalendarValue(b, 'date')))

    if (dateCompare) {
      return dateCompare
    }

    return String(getCalendarValue(a, 'time')).localeCompare(String(getCalendarValue(b, 'time')))
  })
}

function getVisibleCalendarDates() {
  if (calendarViewMode === 'day') {
    return [toDateIso(calendarCursorDate)]
  }

  return getVisibleWeekDays().map(toDateIso)
}

function addRepeatDisplayFields(item, occurrenceDate) {
  if (!isRepeatContextItem(item)) {
    return item
  }

  return {
    ...item,
    baseId: getCalendarValue(item, 'overrideBaseId') || item.baseId || item.id,
    seriesId: getCalendarSeriesId(item),
    occurrenceDate,
  }
}

function findRenderableCalendarItem(itemId) {
  return getRenderableCalendarItems().find((item) => String(item.id) === String(itemId)) || null
}

function getStoredCalendarItem(item) {
  if (!item) {
    return null
  }

  return calendarItems.find((calendarItem) => String(calendarItem.id) === String(item.id)) || null
}

function getRepeatBaseItem(item) {
  if (!item) {
    return null
  }

  if (Boolean(getCalendarValue(item, 'repeatWeekly')) && !item.isRepeatOccurrence && !getCalendarValue(item, 'overrideOf')) {
    return getStoredCalendarItem(item) || item
  }

  const baseId = item.baseId || getCalendarValue(item, 'overrideBaseId')

  if (baseId) {
    const base = calendarItems.find((calendarItem) => String(calendarItem.id) === String(baseId))
    if (base) {
      return base
    }
  }

  const seriesId = getCalendarValue(item, 'overrideOf') || getCalendarSeriesId(item)
  return calendarItems.find((calendarItem) => (
    String(calendarItem.id) === String(seriesId)
    || String(getCalendarSeriesId(calendarItem)) === String(seriesId)
  ) && Boolean(getCalendarValue(calendarItem, 'repeatWeekly')) && !getCalendarValue(calendarItem, 'overrideOf')) || getStoredCalendarItem(item)
}

function isRepeatContextItem(item) {
  return Boolean(
    item?.isRepeatOccurrence
    || getCalendarValue(item || {}, 'repeatWeekly')
    || getCalendarValue(item || {}, 'overrideOf')
    || getCalendarValue(item || {}, 'overrideBaseId')
  )
}

function isBaseOriginalOccurrence(item, baseItem) {
  if (!item || !baseItem) {
    return false
  }

  return !item.isRepeatOccurrence
    && !getCalendarValue(item, 'overrideOf')
    && String(item.id) === String(baseItem.id)
    && getOccurrenceDate(item) === getCalendarValue(baseItem, 'date')
}

function getCalendarSeriesId(item) {
  return String(getCalendarValue(item || {}, 'seriesId') || item?.seriesId || item?.id || '')
}

function getCalendarExceptions(item) {
  const exceptions = getCalendarValue(item || {}, 'exceptions')

  if (Array.isArray(exceptions)) {
    return [...new Set(exceptions.map(toDateString).filter(Boolean))]
  }

  if (typeof exceptions === 'string') {
    return [...new Set(exceptions.split(/[;,]/).map(toDateString).filter(Boolean))]
  }

  return []
}

function findRepeatOverride(seriesId, occurrenceDate) {
  const targetDate = toDateString(occurrenceDate)

  return calendarItems.find((item) => {
    if (getCalendarValue(item, 'date') !== targetDate) {
      return false
    }

    return String(getCalendarValue(item, 'overrideOf')) === String(seriesId)
      || String(getCalendarValue(item, 'overrideBaseId')) === String(seriesId)
      || String(getCalendarValue(item, 'overrideBaseId')) === String(getRepeatBaseItem({ seriesId })?.id || '')
  }) || null
}

function isSameRepeatSeries(item, seriesId, baseId) {
  return String(item.id) === String(baseId)
    || String(getCalendarSeriesId(item)) === String(seriesId)
    || String(getCalendarValue(item, 'overrideOf')) === String(seriesId)
    || String(getCalendarValue(item, 'overrideBaseId')) === String(baseId)
}

function getOccurrenceDate(item) {
  return toDateString(item?.occurrenceDate || getCalendarValue(item || {}, 'date'))
}

function getRepeatScope(formData) {
  return String(formData.get('repeatScope') || 'series')
}

function buildOverrideItemData(baseItem, itemData) {
  return {
    ...calendarItemToData(baseItem),
    ...itemData,
    repeatWeekly: false,
    weekdays: false,
    exceptions: [],
    repeatUntil: '',
  }
}

function calendarItemToData(item) {
  return {
    household_id: getHouseholdId(activeHousehold),
    title: getCalendarValue(item, 'title'),
    date: getCalendarValue(item, 'date'),
    time: getCalendarValue(item, 'time'),
    person: getPrimaryCalendarPerson(item),
    people: getCalendarItemPeople(item),
    type: normalizeTypeValue(getCalendarValue(item, 'type')),
    durationMin: parseOptionalNumber(getCalendarValue(item, 'durationMin')),
    location: getCalendarValue(item, 'location'),
    note: getCalendarValue(item, 'note'),
    done: Boolean(getCalendarValue(item, 'done')),
    repeatWeekly: Boolean(getCalendarValue(item, 'repeatWeekly')),
    weekdays: false,
    repeatUntil: getCalendarValue(item, 'repeatUntil'),
    exceptions: getCalendarExceptions(item),
    seriesId: getCalendarSeriesId(item),
    overrideOf: getCalendarValue(item, 'overrideOf'),
    overrideBaseId: getCalendarValue(item, 'overrideBaseId'),
    repeatYearly: Boolean(getCalendarValue(item, 'repeatYearly')),
    birthYear: getCalendarValue(item, 'birthYear'),
  }
}

async function addRepeatException(baseItem, occurrenceDate) {
  const exceptions = [...new Set([...getCalendarExceptions(baseItem), toDateString(occurrenceDate)].filter(Boolean))]
  return updateBaseRepeatData(baseItem, { exceptions })
}

async function updateBaseRepeatData(baseItem, repeatData) {
  const nextData = {
    ...(baseItem.data || {}),
    repeatWeekly: Boolean(getCalendarValue(baseItem, 'repeatWeekly')),
    seriesId: getCalendarSeriesId(baseItem),
    exceptions: repeatData.exceptions ?? getCalendarExceptions(baseItem),
    repeatUntil: repeatData.repeatUntil ?? getCalendarValue(baseItem, 'repeatUntil'),
  }

  const { error } = await supabase
    .from('calendar_items')
    .update({ data: nextData })
    .eq('id', baseItem.id)

  return { error }
}

async function deleteFutureRepeatOverrides(seriesId, baseId, occurrenceDate) {
  const ids = calendarItems
    .filter((item) => (
      String(getCalendarValue(item, 'overrideOf')) === String(seriesId)
      || String(getCalendarValue(item, 'overrideBaseId')) === String(baseId)
    ))
    .filter((item) => toDateString(getCalendarValue(item, 'date')) >= occurrenceDate)
    .map((item) => item.id)

  return deleteCalendarItemsByIds(ids)
}

function getWeekdayDates(dateIso) {
  const date = parseDateIso(dateIso) || new Date()
  const monday = getStartOfWeek(date)

  return Array.from({ length: 5 }, (_, index) => {
    const weekday = new Date(monday)
    weekday.setDate(monday.getDate() + index)
    return toDateIso(weekday)
  })
}

function addDaysIso(dateIso, days) {
  const date = parseDateIso(dateIso)

  if (!date) {
    return ''
  }

  date.setDate(date.getDate() + days)
  return toDateIso(date)
}

function parseDateIso(dateIso) {
  const value = toDateString(dateIso)

  if (!value) {
    return null
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

function toDateString(value) {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

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

function doesItemMatchPersonFilter(item) {
  if (activePersonFilter === 'Alle') {
    return true
  }

  const people = getCalendarItemPeople(item).map((person) => person.toLowerCase())
  return people.includes(activePersonFilter.toLowerCase())
}

function getCalendarItemColor(item) {
  const people = getCalendarItemPeople(item)
  const matchingPerson = people
    .map(findHouseholdPersonByName)
    .find(Boolean)

  return matchingPerson?.color || getPersonColor(people[0] || getCalendarValue(item, 'person') || 'Alle')
}

function getCalendarItemPeople(item) {
  const dataPeople = getCalendarValue(item, 'people')

  if (Array.isArray(dataPeople) && dataPeople.length) {
    return normalizeCalendarPeople(dataPeople)
  }

  if (typeof dataPeople === 'string' && dataPeople.trim()) {
    return normalizeCalendarPeople(dataPeople)
  }

  const person = getCalendarValue(item, 'person')

  if (person) {
    return normalizeCalendarPeople(person)
  }

  return ['Alle']
}

function getPrimaryCalendarPerson(item) {
  return getCalendarItemPeople(item)[0] || 'Alle'
}

function findHouseholdPersonByName(name) {
  const normalizedName = String(name || '').trim().toLowerCase()
  return householdPeople.find((person) => String(person.name || '').trim().toLowerCase() === normalizedName) || null
}

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

function getCalendarValue(item, key) {
  const aliases = {
    durationMin: 'duration_min',
    repeatWeekly: 'repeat_weekly',
    repeatYearly: 'repeat_yearly',
    repeatUntil: 'repeat_until',
    birthYear: 'birth_year',
    seriesId: 'series_id',
    overrideOf: 'override_of',
    overrideBaseId: 'override_base_id',
    exceptions: 'exception_dates',
  }
  const alias = aliases[key]

  return item[key] ?? item.data?.[key] ?? (alias ? item[alias] ?? item.data?.[alias] : undefined) ?? ''
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

init()
