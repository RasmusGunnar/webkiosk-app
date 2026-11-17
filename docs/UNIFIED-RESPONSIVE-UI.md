# One product UI

Familiekalender has one product UI, responsive presentation, and platform
capabilities. Normal web/desktop is the design reference. Future native clients
must reuse the same components and tokens; platform features do not select an
alternative visual system.

## Inventory and decisions

| Previous fork | Class | Decision |
| --- | --- | --- |
| Pairing, anonymous wall Auth, restricted projection, PIN/settings, wake lock, inactivity, shortcuts | A: capability | Keep existing services, permission checks and persistence |
| `data-mode=kiosk`, viewport density, fixed heights, grid columns, scrolling | B: responsive | `data-mode` describes mobile/desktop presentation by width; calendar capacity still measures actual available height |
| `renderWallToday`, `renderWallMeals`, `renderKioskShopping`, alternate typography/cards/person chips | C: duplicate design | Remove; use existing desktop renderers and CSS |
| Clock/date, shortcuts, compact family goals | D: wall content | Keep as additions to the common header/Today page; goals reuse the existing compact star component |
| Wall meal/shop actions and reward administration | A: security | Preserve read-only/action restrictions; no new permissions |
| Wall navigation | B/A | Use the same responsive bottom navigation, icons, labels and active state. Wall has four authorized destinations; browser also has Family. No separate navigation skin |

## Boundaries

- `mode()` still supplies the existing capability/security contexts. Do not use it
  for typography, card layout, column counts or row allocation.
- `presentationMode(width)` supplies `body[data-mode=mobile|desktop]`.
- `body[data-device=wall|browser]` identifies capabilities, including larger touch
  targets. `device-capabilities.css` contains only clock, shortcut and touch rules.
- `responsive-desktop.css` retains the desktop rules from `desktop-kiosk.css`.
  The alternative `wall-composition.css` and kiosk presentation selectors are gone.
- Today, calendar, meal plan, shopping, tasks, person chips and compact goals share
  rendering and tokens. Permission checks only change available actions/content.
- Meal cards and Today use one thumbnail markup helper and the existing private
  `MealImages` pipeline. User/household isolation, bounded WebP responses, memory
  and persistent caches are unchanged.
- Shopping categories have natural responsive widths on every device. Read-only
  rows are status indicators rather than pretend interactive checkboxes.
- Automatic density follows shared responsive CSS. An explicit device density
  preference is retained. There are no automatic kiosk item-count budgets.

## Verification

`tests/unified-responsive-browser.mjs` covers eight viewport sizes, the five
product routes, 13 wall content states, overflow and unchanged calendar rows.
Set `VISUAL_PHASE=before`, `UI_PHASE=before`, `PERFORMANCE_BASELINE=1` and
`PERFORMANCE_BASELINE_REF` to the reference commit to capture a deterministic
read-only source baseline. Set both phase variables to `after` and omit
`PERFORMANCE_BASELINE` for the candidate.

`tests/unified-paired-browser.mjs` uses real **local** Supabase Auth, pairing, RLS,
projection and the thumbnail API. It compares the same synthetic family at
1920×1080 under owner and paired-wall sessions, including computed typography,
card colors, spacing, rewards and restricted actions. No hosted data is used.

Existing calendar-capacity, task performance/offline, wake, private image/cache,
revocation and meal removal tests remain relevant. Screenshots and measurements
are generated under `supabase/.temp/unified-responsive-ui/` and are not committed.
They require visual inspection in addition to automatic assertions. The final
acceptance of reading distance and physical touch is the user's comparison on
their laptop and wall display after deployment.

No data migration, Aula scanner/inbox/scheduler change, subscription enforcement
or native implementation belongs to this consolidation.
