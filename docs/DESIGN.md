# Brand Guide and UI Specification (v2)

> All UI work follows this file. Use the tokens; never hard-code colours, sizes or fonts. When a token changes, change it here and in `frontend/src/styles/tokens.css` in the same pull request.
>
> **This version replaces v1.** It is built from the eight reference screens you shared (a dental clinic SaaS dashboard on Behance). The look, layout patterns, type scale and colour approach are followed closely. Colours marked ◆ were sampled from the reference images; everything else is proposed to fill gaps (healthcare safety colours, text-safe shades, borders). The reference's name, logo and artwork are **not** reused: `[Product]` needs its own name and mark (Section 9).
>
> Reference screens covered: dashboard, stocks table, reservations calendar, reservation detail drawer, 3-step waitlist wizard, type and colour sheet, icon sets, logo.

---

## 1. Brand direction

**Feeling:** light, airy, friendly and modern. A soft pale-blue canvas, white floating cards, one confident royal blue, and small bursts of pink, green and amber. It should feel closer to a modern fintech dashboard than a heavy hospital system, while still being precise and safe.

**Principles**
1. **Light and calm.** Pale background, white cards, lots of breathing room, soft shadows, rounded corners everywhere.
2. **One primary colour.** Royal blue `#3F5DE7` ◆ is the only action colour: primary button, links, active nav, selected tab, progress.
3. **Colour is data.** Green, amber, pink, teal and purple appear in charts, status pills and calendar cards, always with a label or icon.
4. **Cards, not walls.** Every piece of content sits in a rounded white card with a clear title and an optional range selector.
5. **Safety stays loud.** Allergy and interaction alerts use the pink-red danger colour with an icon and are never hidden or auto-dismissed.
6. **Everything is one click from search.** A global search pill and a round `+` button are always in the top bar.

**Voice:** short, warm, plain. "Good morning, Ada!" greets the user; empty states and toasts are one sentence. Clinical terms stay standard. No blame in errors.

## 2. Colour

### 2.1 Core palette

| Token | Hex | Use |
| --- | --- | --- |
| `blue-600` ◆ | `#3F5DE7` | **Primary.** Buttons, links, active nav icon and text, active tab, progress fill, `+` button |
| `blue-700` ◆ | `#2D45C9` | Button hover and pressed, link hover |
| `blue-500` | `#5470EA` | Focus ring on dark, secondary emphasis |
| `blue-100` | `#E8F0FB` ◆ (active nav fill) | Active nav pill, selected row, soft blue chips |
| `blue-50` | `#EEF2FE` | Hover on blue-tinted items |
| `sky-400` ◆ | `#63B1FF` | Secondary data colour, "new patients" bar, light blue accents, logo gradient start |
| `ink-900` ◆ | `#243444` | Headings and primary text (dark navy-slate, not black) |
| `ink-600` | `#5B6B7F` | Secondary text (5.5:1 on white) |
| `ink-500` | `#627184` | Captions, column headers (5.0:1 on white, 4.6:1 on `canvas`) |
| `ink-400` | `#8A97A8` | Placeholder, disabled text, inactive icons (decorative only) |
| `ink-300` | `#C5CDD8` | Strong borders, disabled borders |
| `line` | `#E6EAF1` | Card borders, dividers, table rules |
| `canvas` ◆ | `#F4F6FA` | App background (reference `#F3F5F9` to `#F9FBFC`) |
| `sidebar` ◆ | `#F5F7FB` | Sidebar background |
| `surface` | `#FFFFFF` | Cards, inputs, modals, drawers |
| `surface-muted` | `#F8FAFC` | Inner tiles inside cards (for example "Top expense" tiles), table header |
| `disabled-fill` | `#E3E6EC` | Disabled buttons |

### 2.2 Accent palette (from the reference colour sheet ◆)

| Token | Solid ◆ | Tint (backgrounds) | Text-safe shade (on white or tint) | Meaning |
| --- | --- | --- | --- | --- |
| `green` | `#45B787` | `#E5F6EE` | `#187A50` | Success, completed, income, available |
| `amber` | `#F9BD21` | `#FFF4D6` | `#855400` | Warning, pending payment, low stock, expenses |
| `pink` | `#E75787` | `#FDE9F0` | `#B8325F` | Danger, unpaid, out of stock, cancelled, allergy |
| `sky` | `#63B1FF` | `#E6F1FF` | `#1B63BE` | Information, new items |
| `purple` | `#9969F9` | `#F0EBFE` | `#6B46D6` | In progress, partially received |
| `teal` | `#15CFCF` | `#E0F8F8` | `#0B7A80` | Available stock, checked-in |

**Rule:** the *solid* colours are for fills only (bars, dots, donut segments, icons on tinted tiles). Text always uses the *text-safe shade*. The raw solids fail contrast as text (for example `#45B787` on white is 2.5:1, `#F9BD21` is 1.7:1).

### 2.3 Chart colours (from the reference charts ◆)

Income and positive series: `#8DCF99` (soft green bars) · Expenses: `#FFB709` (amber bars) · Cashflow line: `blue-600` with a soft vertical gradient fill from `rgba(63,93,231,.14)` to transparent · Donut segments in order: purple `#9969F9`, lime `#99E76F`, sky `#33B1F3`, pink `#E75787`, orange `#F26A1B`, amber `#FFB709` · Stock bar: available `#15CFCF`, low `#FFB709`, out `#FE3D70` · Tooltip: `ink-900` background, white text, radius 8. Gridlines dotted `#D5DBE5`. Every series needs a direct label or legend; the legend uses a small coloured dot.

### 2.4 Status colour maps (fixed meaning app-wide)

**Appointment status** (calendar card = tint fill + 1 px border at 40% of the solid, status text in text-safe shade with a leading dot, leading icon)

| Status | Tint fill | Solid | Icon |
| --- | --- | --- | --- |
| Booked | `#E6F1FF` | sky | hourglass |
| Confirmed | `#E8F0FB` | blue-600 | calendar-check |
| Checked-In | `#E0F8F8` | teal | map-pin or door |
| In-Consultation | `#F0EBFE` | purple | stethoscope |
| Completed | `#E5F6EE` | green | check (green square) |
| No-Show | `#FFF4D6` | amber | clock-x |
| Cancelled | `#FDE9F0` | pink | x-circle |

**Special calendar strips:** payment pending = full-width yellow strip `#FFF3BD` with a coin icon and uppercase text "WAITING PAYMENT FOR {NAME}" ◆; unavailable = diagonal-hatched light grey with centred "NOT AVAILABLE"; break = hatched with centred "BREAK TIME"; current time = 1 px `#E5484D` line across all columns with a dark time pill.

**Table status pills** (uppercase 10.5 px, weight 700, radius 6, tint fill, text-safe text): PENDING grey (`#EDEFF3` / `ink-600`), COMPLETE green, PARTIALLY RECEIVED purple, CANCELLED pink, PAID green, UNPAID pink (solid-ish), PARTIALLY PAID amber.
**Triage priority:** Emergency pink · Urgent amber · Routine sky · Non-urgent grey.
**Bed:** Vacant green · Occupied sky · Cleaning amber · Out of service grey.
**Allergy / interaction alert:** pink tint fill, 1 px pink border, pink icon, text `#B8325F` for the title and `ink-900` for the body.

### 2.5 Contrast (computed, WCAG 2.x)
White on `blue-600` 5.3:1 · `blue-600` on white 5.3:1 · `blue-600` on `blue-100` 4.7:1 · `ink-900` on white 12.7:1 · `ink-600` on white 5.5:1 · `ink-500` on white 4.6:1 · green text `#187A50` on white 5.3:1 and on its tint 4.8:1 · pink text `#B8325F` on white 5.7:1 and on tint 4.9:1 · amber text `#855400` on white 6.4:1 and on tint 5.9:1 · sky text `#1B63BE` on tint 5.1:1 · purple text `#6B46D6` on tint 5.2:1 · teal text `#0B7A80` on white 5.1:1 and on tint 4.6:1 · white on `green-btn` `#1C855D` 4.6:1 · `ink-500` on `canvas` 4.6:1, on `sidebar` 4.7:1 and on `surface-muted` 4.8:1. All pass 4.5:1, and `frontend/src/lib/contrast.test.ts` fails if any text pair drops below it.

*Adjusted 2026-10-16:* `teal-text` (was `#0B7F85`), `green-btn` (was `#1F9467`) and `ink-500` (was `#66768A`) were darkened slightly because Checked-In pills, the success button and table headers on `surface-muted` fell below 4.5:1.

### 2.6 Gradients and surfaces
- App canvas has a very faint blurred blue radial glow in the top-left (`rgba(99,177,255,.10)`), nothing more.
- Logo mark and large marketing shapes may use `#7BABFF → #3F5DE7`. No gradients on buttons, cards or text.
- Dark mode: not in version 1; use tokens so it can follow.

## 3. Typography

- **Typeface: Manrope** (the reference's choice), weights **500, 600, 700** (and 400 for long body text). Load with `next/font/google`, `display: swap`, fallback `system-ui, -apple-system, "Segoe UI", sans-serif`.
- Mono for MRN, IDs and codes: `ui-monospace, "JetBrains Mono", Menlo`.
- Numbers: use tabular figures in tables, KPIs, vitals and money (`font-variant-numeric: tabular-nums`; test that Manrope renders them aligned and fall back to mono for MRN).
- Text colour is `ink-900` for primary, `ink-600` for secondary. Never pure black.

| Style | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | 28 / 36 | 700 | Greeting, empty states (the reference's large "Aa") |
| Page title | 20 / 28 | 700 | Top bar title ("Dashboard", "Stocks") |
| Card title | 15 / 22 | 600 | "Cashflow", "Expenses" |
| KPI | 24 / 32 | 700 | "$13,232", "$10,200,323" |
| KPI small | 20 / 28 | 700 | Secondary figures |
| Body | 14 / 22 | 500 | Default text, table cell main line |
| Body regular | 14 / 22 | 400 | Paragraphs, notes |
| Small | 12.5 / 18 | 500 | Table sub-line ("5 items • $1,500"), helper text |
| Label caps | 11 / 16 | 600, +0.04em, uppercase | KPI labels ("TOTAL CASH"), column headers, sidebar group captions |
| Pill | 10.5 / 14 | 700, uppercase | Status pills |

Smallest text is 10.5 px, used only for uppercase pills. Body never below 12.5 px.

## 4. Shape, spacing, elevation

- **Grid:** 4 px base. Common gaps: 8, 12, 16, 20, 24. Page padding 24. Card padding 20. Gap between cards 16 to 20.
- **Radius:** cards 14 · modals and drawers 16 · buttons and inputs 10 · pills and chips 999 · small tags 6 · calendar cards 8 · avatar circle · outer app frame 28 (presentation frame only, not in production UI).
- **Borders:** 1 px `line` on cards, inputs, tables. Cards also carry a very soft shadow.
- **Shadows:** card `0 1px 2px rgba(36,52,68,.04), 0 6px 20px rgba(36,52,68,.05)` · popover/menu `0 8px 28px rgba(36,52,68,.12)` · modal and drawer `0 16px 48px rgba(36,52,68,.18)` over a scrim `rgba(36,52,68,.45)`.
- **Focus ring:** 2 px `blue-600` with 2 px white offset.
- **Motion:** 150 ms ease-out for hover, dropdowns and toasts; 220 ms slide for drawers; progress bars animate width. Respect `prefers-reduced-motion`.

## 5. Iconography and imagery

- **Icons:** the reference uses three rounded sets: **outline** (default UI), **solid** (active or emphasised), **duo-tone** (collapsed sidebar and feature tiles). Use **Phosphor Icons** (regular, fill, duotone weights; MIT licence) so all three exist in one family. 20 px in nav and buttons, 24 px in tiles, 16 px inside inputs and pills.
- Default icon colour `ink-500`; active nav icon `blue-600`; icons on tinted tiles use the matching solid colour.
- **Icon tiles:** 36 to 44 px rounded squares (radius 10) with a tint fill and a solid icon, used for KPI headers (a coin tile on "Total asset value"), file types (blue doc, teal image, red PDF) and drawer detail rows.
- **Avatars:** staff and patients use photos where provided, otherwise **initials on a coloured circle** (pink, amber, blue, green from the accent set) 32 px; large 40 px in headers and drawers. Patients default to initials only.
- No stock photography in the product UI. Illustrations only on empty states, flat, using the accent palette.

## 6. App shell and layout

```
┌──────────────┬──────────────────────────────────────────────────────────────────────┐
│ [logo] Name ‹│ Page title      ( 🔍 Search for anything here…  )  (+)  ?  ∿  ⚙  ⚑1/4  (AB) Name ▾ │
│              │                                                       Role              │
│ ┌──────────┐ ├──────────────────────────────────────────────────────────────────────┤
│ │ ▣ Clinic │ │ Good morning, Ada!                                                   │
│ │ address  │ │ Friday, October 16, 2026                                             │
│ └──────────┘ │                                                                      │
│ ▣ Dashboard  │ ┌ card ─────────────────────────┐ ┌ card ────────────┐               │
│ CLINIC       │ │                               │ │                  │               │
│  Appointments│ └───────────────────────────────┘ └──────────────────┘               │
│  Patients    │                                                                      │
│  ...         │                                                                      │
│ ──────────── │                                                                      │
│  Report      │                                                                      │
│  Support     │                                                                      │
└──────────────┴──────────────────────────────────────────────────────────────────────┘
```

**Sidebar** (240 px, `sidebar` background, right border `line`; collapses to a 72 px icon rail using the duo-tone icons)
- Top: logo and product name, plus a small round collapse chevron button on the sidebar edge.
- Below: **facility switcher card**: white card, icon tile, facility name (600) and address (small, grey). Opens a menu to switch facility or branch.
- Nav items 40 px high, radius 10, icon 20 px and label 14/500. **Active item: `blue-100` fill, `blue-600` icon and text, label weight 600.** Hover: `#EDF1F8`.
- Group captions in label-caps style (`CLINIC`, `FINANCE`, `PHYSICAL ASSET`), 24 px above each group.
- Bottom, separated by a rule: Report, Customer Support.

**Top bar** (64 px, white or canvas with bottom border `line`)
- Page title left (20/700).
- Centre-right: **search pill** (full radius, `#EEF1F6` fill, no border, search icon, placeholder "Search for anything here…", 360 px wide, `⌘K`). It searches patients by name, MRN or phone first.
- **Round `+` button** (40 px, `blue-600`, white plus) opens a quick-create menu: New patient, New appointment, New invoice, New order.
- Icon buttons (ghost, 36 px): Help, Activity/notifications, Settings.
- **Setup progress chip**: green flag icon and "1/4" in a light green pill; shows onboarding progress (tenant setup steps). Hidden when setup is complete.
- User block: avatar, name (600), role in small grey (for example "Super admin"), chevron menu.

**Content area**
- Canvas `#F4F6FA`, page padding 24, max width 1440, then centred.
- Page header pattern: greeting or title, optional sub-line (date), then tabs or filters, then cards.
- 12-column grid, 16 to 20 px gaps. Typical dashboard split: 8/4, or 3 columns of 4.

**Responsive:** 1280+ full sidebar; 1024 to 1279 icon rail; below 1024 sidebar becomes a drawer opened from a hamburger. Tables scroll horizontally; calendar switches to a single-doctor day view on narrow screens. Patient portal is mobile-first (Section 8).

## 7. Components

| Component | Spec |
| --- | --- |
| **Primary button** | `blue-600` fill, white text 14/600, 40 px high, radius 10, optional leading icon; hover `blue-700`; disabled `disabled-fill` with `ink-400` text (the "Receive" and "Finish" disabled look) |
| **Outline button** | White fill, 1 px `blue-600` or `ink-300` border, `blue-600` or `ink-900` text ("Receive", "Today", "Filters") |
| **Ghost button / text link** | No fill, `blue-600` text 600 ("Order", "View all", "Edit", "Extend time"); hover underline |
| **Dashed action button** | 1 px dashed `blue-600` border, `blue-600` text, icon ("Add Medical Record") for optional add actions |
| **Success button** | `green` text-safe darker fill `#1C855D` with white text and a check badge ("Edit Medical Checkup") |
| **Round icon button** | 40 px circle; the `+` is filled blue; others are ghost |
| **Segmented control** | Two or three options in a pill track `#EEF1F6`; active segment white with shadow ("Day" / "Week") |
| **Range selector** | Small outline pill dropdown at the card's top-right: "Last 12 months ▾", "This month ▾" |
| **Search pill** | Full radius, `#EEF1F6` fill, 40 px, icon left; in tables a white version with `line` border, 36 px |
| **Input** | 44 px, white, 1 px `line` (hover `ink-300`, focus 1.5 px `blue-600` plus soft blue glow), radius 10, placeholder `ink-400`; icon inside left for phone, email, clock, calendar; label above in 12.5/600 `ink-600`; optional marker "(Optional)" in grey; character counter right ("42/200") |
| **Select / combobox** | Same as input with chevron; option rows 40 px; selected option shows a blue check; searchable for long lists |
| **Gender / yes-no chips** | Pill-like bordered radio cards; selected has `blue-600` border, blue-tint fill and a filled radio dot |
| **Radio cards (questionnaire)** | Bordered white tiles in a 2 or 3 column grid, radio dot left, text right |
| **Textarea** | Same as input, resizable, counter |
| **Upload dropzone** | Dashed `blue-600`-tinted border, centred icon, "Drag and drop files here | Browse Files" (link), helper "Maximum upload file size: 10MB", count "0 of 5" |
| **Upload file row** | File-type icon tile (blue doc, teal image, red PDF), name (600), size, percentage right, thin progress bar (blue while uploading, green when complete), remove or trash icon |
| **Tabs** | Text tabs, 14/600, inactive `ink-500`, active `blue-600` with a 2 px blue underline; counts in small grey |
| **Card** | White, radius 14, border `line`, soft shadow, padding 20; header row = title (15/600) left, range selector or action right |
| **KPI block** | Label caps grey above, value 24/700, optional delta chip (green up arrow with percent, pink down arrow), optional icon tile |
| **Delta chip** | Small pill, tint fill, arrow icon and percent in text-safe colour |
| **Segmented stat bar** | 6 px high rounded bar split into coloured segments with a legend of dots and counts below ("In stock 20", "Low stock 4", "Out of stock 8") |
| **Progress bar** | 6 px, track `#E6EAF1`, fill `blue-600` (or green when complete); fraction text right ("2/4") |
| **Donut chart** | 14 px ring, rounded caps, total in the centre (label small, value 20/700), legend right with dot, name and percent |
| **Mini tiles** | `surface-muted` rounded tiles in a 2x2 grid with dot, label and bold value ("Top expense") |
| **Tooltip (chart)** | `ink-900` fill, white text, radius 8, small label and bold value; vertical hairline and ring marker on the line |
| **Rating row** | Name left, gold star icon and number right (`amber`) |
| **Data table** | See 7.1 |
| **Status pill** | See 2.4 |
| **Avatar group / avatar** | See Section 5 |
| **Banner (info)** | Light sky tint, sky text, left info icon, optional blue link action right ("Extend time") |
| **Banner (danger, allergy)** | Pink tint, pink border, alert icon, bold title; persistent |
| **Stepper** | 3 circles with icons connected by lines; **active** = filled blue circle with white icon, **done** = filled green circle with a check, **upcoming** = light grey circle with grey icon; "STEP n" in small grey caps above the step name (600) |
| **Modal** | Radius 16, white, 560 wide (wizard) or 480 (confirm); title 16/700 left, close X right; scrollable body; sticky footer with a top rule: Cancel (text) left, Previous (outline) and Next (primary) right |
| **Side drawer** | Right-anchored, 520 to 560 wide, radius 16 on the left corners, over a scrim; a narrow vertical icon-tab rail on its left edge for sections (Visit, Clinical record, Billing); header with ID, type tag, edit icon and close; footer with action buttons |
| **Dropdown menu / kebab** | White, radius 12, popover shadow, 40 px rows, icons left |
| **Toast** | Bottom right, white card with coloured left icon, 4 s; errors stay |
| **Floating feedback button** | Pill at bottom right with a green dot and "Feedback", white with shadow |
| **Empty state** | Flat illustration, one sentence, one primary button |
| **Skeleton** | `#EDF0F5` blocks with a faint shimmer; no spinners for page loads |

### 7.1 Data table (matches the Stocks screen)
- Sits in the page directly on the canvas or in a card; **no outer border**, rows separated by 1 px `line` rules.
- Toolbar above: search pill left; **Filters** outline button with a sliders icon and the primary action (for example "+ Order Stock") right.
- Header row: label-caps style, `ink-500`, small sort arrows, 40 px high, `surface-muted` fill, first column holds a select-all checkbox.
- Body rows 56 px (compact 44): checkbox, **two-line first cell** (bold identifier line like `#OS12KOS` and a grey sub-line "5 items • $1,500"), date column, entity with a small icon ("from vendor"), status pill, progress bar with fraction, a green check circle for "email sent", an outline action button ("Receive") that turns grey-disabled when not applicable, and a kebab menu.
- Row hover `#F8FAFC`; selected row `blue-100`. Pagination at the bottom, "Rows per page" selector.
- Empty, loading (skeleton rows) and error states are required.

### 7.2 Calendar (matches the Reservations screen)
- Header: tabs **Calendar** and **Log History**; below, a calendar-icon tile with the count ("16" big, "total appointments" small), a **Today** outline button with prev and next arrows, the full date ("Fri, 16 Oct 2026"), a **Day / Week** segmented control, a physician filter dropdown ("All doctors") and **Filters**.
- Day view: one **column per physician** with avatar, name, small "Today's appointment · 4 patient(s)", kebab menu. Left time axis (9am to 5pm, hour rows 60 px) with timezone label ("GMT +01:00").
- Appointment card: tinted by status (Section 2.4), 8 px radius, content = status icon tile, patient name (600), time range ("09:00 AM > 10:00 AM"), status text with dot right-aligned, treatment tag chip at the bottom ("General Checkup"). Height scales with duration.
- Unavailable and break periods hatched; payment strips yellow; **current time** red line with a dark time pill at the left.
- Click a card opens the **appointment drawer** (7.3); click an empty slot opens the booking wizard prefilled with the physician and time. Drag to reschedule with conflict blocking.
- Week view: columns are days for the selected physician.

### 7.3 Appointment drawer (matches the Reservation detail screen)
Header: "Appointment ID **#APT0011**" with a type tag ("MANUAL", "ONLINE", "WALK-IN"), edit icon, close.
Body, top to bottom:
1. **Patient card:** initials avatar, name (large), **status dropdown** on the right ("Booked ▾"), the reason or quick note with an "Edit" link.
2. **Info banner** where relevant (for example "Time slot available later, you can extend the appointment time" with an "Extend time" link).
3. **Detail row** with three icon tiles: Treatment or service, Date and time, Physician.
4. **Payment row:** "Payment · Bill #10102" with an UNPAID pill and a **Send Reminder** outline button with a bell icon.
5. **General info**: two-column label (caps, grey) and value (600) grid: full name, phone, age and date of birth, email, gender, address. **The patient's allergy chip and active alerts appear here in pink** (our addition).
Footer: green **Edit Medical Checkup** (vitals and examination), dashed **Add Medical Record** (diagnosis and note), then a grey disabled **Finish** with the helper line "Please add vitals and a clinical record to finish this visit." Finish enables only when the required clinical records exist (our rule: a visit cannot be completed without them).
Left icon rail inside the drawer switches between Visit, Clinical record and Billing.

### 7.4 Multi-step wizard (matches the waitlist modal)
Used for: new appointment, patient registration, admission, new order.
- Stepper at the top (Section 7 table). Body shows one step; footer Cancel / Previous / Next; the last step's primary button says "Save" or "Finish".
- Step 1 for appointments: service, physician card (avatar, name, "Today's appointment: 4 patient(s)"), date and time range inputs with clock icons, quick note with counter, attachments dropzone.
- Step 2: patient basics (name, age or date of birth, gender chips, email, phone, address with counter).
- Step 3: optional medical history questions as radio cards, with a sky info banner ("Optional, you can do it later").
- Validation is inline, per field, and blocks Next until the step is valid.

## 8. Screens for our product (mapped from the reference)

| Our screen | Reference pattern | Content |
| --- | --- | --- |
| **Dashboard** | Dashboard | Greeting with date. Row 1: **Cashflow** area line chart with total, delta chip, range selector, hover tooltip (8 cols) and **Expenses** donut with top-expense tiles (4 cols). Row 2: **Income & Expense** paired bars, **Patients** (new vs returning with percentages and a bar), **Popular Services** list with ratings; right column **Stock availability** segmented bar and low-stock list with "Order" links. Clinical roles get a variant: today's queue, results to review, alerts. |
| **Patients** | Stocks table | Table with search, Filters, "+ New patient". Columns: name with avatar, MRN (mono), age and sex, phone, last visit, status pill, allergy chip, kebab. Duplicate-review badge in the header. |
| **Patient chart** | Drawer plus tabs | Sticky patient banner (name, age, MRN, allergy chips in pink, status, physician) and tabs Overview, Vitals, Diagnoses, Notes, Orders, Prescriptions, Results, Billing, Documents, Audit. Overview uses KPI-style vitals tiles with delta arrows, a timeline card and a right column of Active problems, Medications and Allergies cards. |
| **Appointments** | Reservations | Calendar and list view as in 7.2, seven statuses mapped in 2.4. |
| **Queue** | Table | Live table sorted by triage priority then arrival, waiting-time chip turning amber then pink, "Start consultation" primary outline button. |
| **Prescriptions / Orders** | Wizard and table | Wizard for authoring with the interaction alert banner above the Sign button; table of orders with status pills. |
| **Pharmacy stock** | Stocks | Header KPI (total asset value with coin tile, product count, segmented in-stock / low / out bar), tabs **Inventory** and **Order Stock**, table exactly as the reference (order id, created, vendor, status pill, items received progress, email sent check, Receive button). |
| **Billing / Invoices** | Table plus drawer | Invoice table with PAID, UNPAID, PARTIALLY PAID pills; invoice drawer with line items, source tags, insurer/patient split, totals card and "Send Reminder". |
| **Finance** | Dashboard cards | Accounts, sales, purchases, payment methods using the same KPI and chart cards. |
| **Staff list** | Staff table (screen 1) | Tabs Doctors / General staff, count, table with avatar, name, specialty, shift status pill, licence expiry chip (amber when near, pink when expired). |
| **Inpatient (R2)** | Cards and tiles | Ward board of bed tiles in the bed colours; right drawer for admit, transfer, discharge. |
| **Admin / audit** | Table | Filterable audit table; break-glass rows pinned with a pink tint. |
| **Patient portal** | Same tokens, lighter shell | Top navigation instead of sidebar, 16 px body, 44 px targets, mobile-first; Home (next appointment card, new results, balance), Appointments, Results, Prescriptions, Invoices, Profile. |

### Navigation (staff app)

```
[Facility switcher]
Dashboard
CLINIC        Appointments · Patients · Consultations · Orders and Prescriptions · Results · Staff List
INPATIENT     Wards and Beds · Admissions                     (Release 2)
FINANCE       Invoices · Payments · Claims · Accounts · Sales · Purchases
PHYSICAL ASSET Pharmacy Stock · Inventory · Equipment
─────────────
Report
Customer Support
```
Each role sees only its groups; hiding is a convenience, the server enforces access.

### States every screen must handle
Loading (skeleton), empty (illustration plus one action), error (what happened plus retry), no permission (clear message, no data shown), slow or offline (banner, keep input), saving (button progress), success (toast), and **destructive confirm** (modal with the danger button).

### Accessibility
WCAG 2.2 AA. Text colours only from the text-safe shades. Status is never colour alone (icon, label or dot plus text). Visible focus, full keyboard use (including the calendar and wizard), labelled controls, `aria-live` for queue and toasts, 44 px targets in the portal and on tablet, reduced-motion respected.

## 9. Logo and brand assets
- Create an **original** wordmark and mark for `[Product]`. The reference's mark is a stethoscope-like rounded "U" in a light-to-royal-blue gradient; do not copy it or its name. Use the same *feeling*: a simple rounded glyph (for example a cross or pulse shape made from rounded strokes) filled with the gradient `#7BABFF → #3F5DE7`, next to the name in Manrope 700.
- Sizes: mark alone 32 px in the sidebar; collapsed sidebar shows the mark only. Clear space equal to the mark's height; minimum mark 24 px.
- Versions: gradient on white, solid `blue-600` one-colour, white on `blue-600`/navy, black.
- Favicon: the mark on a `blue-600` rounded square.

## 10. Tokens for code

### CSS variables (`frontend/src/styles/tokens.css`)
```css
:root {
  /* brand */
  --blue-50:#EEF2FE; --blue-100:#E8F0FB; --blue-500:#5470EA; --blue-600:#3F5DE7; --blue-700:#2D45C9;
  --sky-400:#63B1FF;
  /* ink */
  --ink-900:#243444; --ink-600:#5B6B7F; --ink-500:#627184; --ink-400:#8A97A8; --ink-300:#C5CDD8;
  --line:#E6EAF1; --canvas:#F4F6FA; --sidebar:#F5F7FB; --surface:#FFFFFF; --surface-muted:#F8FAFC;
  --disabled-fill:#E3E6EC; --pill-grey:#EDEFF3;
  /* accents: solid / tint / text-safe */
  --green:#45B787;  --green-tint:#E5F6EE;  --green-text:#187A50; --green-btn:#1C855D;
  --amber:#F9BD21;  --amber-tint:#FFF4D6;  --amber-text:#855400; --amber-strip:#FFF3BD;
  --pink:#E75787;   --pink-tint:#FDE9F0;   --pink-text:#B8325F;
  --sky:#63B1FF;    --sky-tint:#E6F1FF;    --sky-text:#1B63BE;
  --purple:#9969F9; --purple-tint:#F0EBFE; --purple-text:#6B46D6;
  --teal:#15CFCF;   --teal-tint:#E0F8F8;   --teal-text:#0B7A80;
  --now-line:#E5484D;
  /* chart */
  --chart-income:#8DCF99; --chart-expense:#FFB709; --chart-out:#FE3D70; --chart-orange:#F26A1B;
  --chart-lime:#99E76F; --chart-sky:#33B1F3; --chart-grid:#D5DBE5;
  /* shape */
  --r-pill:999px; --r-card:14px; --r-modal:16px; --r-control:10px; --r-tag:6px; --r-cal:8px;
  --shadow-card:0 1px 2px rgba(36,52,68,.04),0 6px 20px rgba(36,52,68,.05);
  --shadow-pop:0 8px 28px rgba(36,52,68,.12);
  --shadow-modal:0 16px 48px rgba(36,52,68,.18);
  --scrim:rgba(36,52,68,.45);
  --font-sans:"Manrope",system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-mono:ui-monospace,"JetBrains Mono",Menlo,monospace;
}
```

### Tailwind (`theme.extend`)

The app uses Tailwind 4, which has no `tailwind.config.ts`: the same names are mapped onto the CSS variables above with `@theme` in `frontend/src/styles/theme.css`, so `tokens.css` stays the single place where values live.
```ts
colors: {
  blue:  { 50:'#EEF2FE',100:'#E8F0FB',500:'#5470EA',600:'#3F5DE7',700:'#2D45C9' },
  sky:   { DEFAULT:'#63B1FF', tint:'#E6F1FF', text:'#1B63BE' },
  ink:   { 900:'#243444',600:'#5B6B7F',500:'#627184',400:'#8A97A8',300:'#C5CDD8' },
  line:'#E6EAF1', canvas:'#F4F6FA', sidebar:'#F5F7FB', 'surface-muted':'#F8FAFC',
  green: { DEFAULT:'#45B787', tint:'#E5F6EE', text:'#187A50', btn:'#1C855D' },
  amber: { DEFAULT:'#F9BD21', tint:'#FFF4D6', text:'#855400', strip:'#FFF3BD' },
  pink:  { DEFAULT:'#E75787', tint:'#FDE9F0', text:'#B8325F' },
  purple:{ DEFAULT:'#9969F9', tint:'#F0EBFE', text:'#6B46D6' },
  teal:  { DEFAULT:'#15CFCF', tint:'#E0F8F8', text:'#0B7A80' },
},
borderRadius: { card:'14px', modal:'16px', control:'10px', tag:'6px' },
boxShadow: {
  card:'0 1px 2px rgba(36,52,68,.04),0 6px 20px rgba(36,52,68,.05)',
  pop:'0 8px 28px rgba(36,52,68,.12)', modal:'0 16px 48px rgba(36,52,68,.18)',
},
fontFamily: { sans:['Manrope','system-ui','sans-serif'], mono:['ui-monospace','JetBrains Mono','monospace'] },
```

## 11. Build order for the UI (add to the frontend prompt)
1. Tokens, fonts (Manrope via `next/font`), Phosphor icons, base layout and a `/design` page showing every token and component.
2. Shell: sidebar (expanded and collapsed), facility switcher, top bar with search pill, `+` menu, setup chip, user menu.
3. Core components in this order: Button set, Input family, Select, Tabs, Segmented control, Card with range selector, KPI block, Pill and Delta chip, Avatar, Progress and segmented bar, Table, Modal and Stepper, Drawer, Banner, Toast, Empty and Skeleton.
4. Charts (area, paired bar, donut) using one chart library themed with the chart tokens (Recharts or similar), with tooltips matching 2.3.
5. Screens in the order of the release plan: Dashboard, Patients, Patient chart, Appointments calendar and drawer, Queue, Prescribing, Billing; then Pharmacy stock.
6. A single mapping file for status colours and icons so they never drift.

## 12. Rules for Claude Code
- Use only these tokens. No raw hex in components; no new colours without editing this file.
- Raw accent solids are for fills and icons only; text always uses the `-text` shade.
- Every list screen implements loading, empty, error and no-permission states.
- Cards, tables, calendar cards, drawers and wizards follow Section 7 exactly; do not invent new patterns when one exists.
- No stock photos, no gradients except the logo mark, no shadows beyond Section 4.
- Do not reproduce the reference's name, logo or artwork anywhere.
- No AI attribution anywhere in code, commits or docs.

## 13. Still to confirm
1. Product name and logo concept.
2. Whether blue stays the brand colour (the reference's blue is used as the base here).
3. Dark mode at launch or later.
4. Default currency and date format shown in the UI (Naira with `₦`, day-month-year assumed).
