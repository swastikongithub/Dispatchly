# Dispatchly: Build Plan

**Live delivery dispatch and tracking platform.** ASP.NET Core (.NET 10) · Angular 22 · PostgreSQL + PostGIS
Designs approved: 26 Nov 2026 · Web first, then a mobile app (Part B)

---

## What's in this pack

| Path | What it is | Use it for |
|---|---|---|
| `PLAN.md` | This document | The full build plan |
| `CLAUDE.md` | Rules for Claude Code | Copy into the repo root. Claude Code reads it automatically |
| `design-tokens.json` | Every colour, font size, radius, shadow and motion value from the designs | Generates the Tailwind theme (web) and the theme object (mobile) |
| `designs/screenshots/*.png` | Approved screens: landing, dashboard, tracking, rider, plus both map styles | The visual target. Compare every built screen against these |
| `designs/html/*.html` | The same screens as standalone HTML (open in any browser) | Exact values: inspect them in DevTools for spacing, sizes and copy |
| `designs/source/` | Original design-canvas source files | Archive only. These need the canvas runtime to open |

---

# 0. Non-negotiables (read before writing any code)

## 0.1 The designs are the source of truth
1. **Match the approved designs exactly:** layout, colours, fonts, sizes, spacing, radii, shadows, icons and copy. When the PNG and HTML disagree, the HTML values win.
2. **Every value comes from `design-tokens.json`.** No hard-coded hex values, no "close enough" colours, and no new font sizes, radii or shadows.
3. **Copy is part of the design.** Use the exact words from the designs ("Needs rider", "Slide to confirm pickup", "Arriving in", "Share it with Aman at the door"...). Real data replaces the sample names and numbers, but labels and microcopy stay word-for-word.
4. **No UI kits.** No Angular Material, PrimeNG, Bootstrap, DaisyUI, Spartan or shadcn-style kits. Build components from the designs on top of Angular CDK/Aria, which provide behaviour only.
5. **Screens that weren't designed** (§5.5) are built only from existing components and tokens. Screenshot them and get approval before polishing.
6. **Only the deviations listed in §11 are allowed.** Anything else that looks wrong in a design gets raised as a question, not silently "improved".

## 0.2 The experience bar: smooth, rich, never generic
- **Nothing on screen jumps.** Riders glide between GPS updates, numbers tick, panels slide, the camera flies. Every change of state animates (see §6).
- **60 fps** on the dashboard with 500 moving riders on a mid-range laptop.
- **Every screen handles all its states:** loading, empty, error, reconnecting, offline and finished. A blank or frozen screen is a bug.
- **Instant feedback:** every press shows a visible reaction within 100 ms, and actions update the UI optimistically and roll back on failure.
- **Accessible:** keyboard-operable, visible focus, 4.5:1 text contrast (the designs already pass), and "reduce motion" respected.
- **Works at every size:** 360 px phones up to 1920 px desktops (see the responsive notes in §5).

## 0.3 Banned "AI slop" patterns
Never add:
- purple/blue gradients, gradient text, glassmorphism or blur on everything, neon glows
- emoji used as icons, stock illustrations, 3D blobs
- generic "hero + three feature cards" sections, testimonials, logo walls, fake stats or claims
- default framework looks: Material ripple buttons, Bootstrap cards, default Tailwind palette colours
- lorem ipsum or placeholder names; use the canon data in §12
- coloured left-border cards, drop shadows on everything, more than one accent colour

## 0.4 How each screen gets built (the fidelity loop)
1. Open `designs/screenshots/<screen>.png` and `designs/html/<screen>.html` side by side.
2. Build the screen using tokens and shared components.
3. Take a screenshot of the built screen at the design's viewport: 1440×900 for desktop, 390×844 for phones.
4. List every visible difference from the design, fix them, and repeat until only §11 deviations remain.
5. Check the motion, states and responsive behaviour from §5–§6.
6. Commit, then record a short screen capture for the PR or README.

---

# 1. Product

## 1.1 What it is
Dispatchly is a real-time delivery dispatch system for a simulated central Delhi. Orders come in, each goes automatically to the **nearest free rider** (found with PostGIS), and everyone involved watches it move live:
- dispatchers see the whole city
- customers see their own rider
- riders see their next task

## 1.2 Roles and core flows
| Role | Screen | Core flow |
|---|---|---|
| Visitor | Landing `/` | Understand the product in 10 seconds, then go to the live demo |
| Dispatcher | Dashboard `/dispatch` | Watch riders live → spot "Needs rider" and "Running late" → select a rider or order → call or reassign |
| Customer | Order `/order` → Tracking `/track/:code` | Pick a restaurant → set the drop pin → place the order → watch the ETA and rider → hand over the delivery code |
| Rider | Rider app `/rider` | Go online → get a task → navigate → slide to confirm pickup → navigate → enter the code and slide to confirm delivery |

## 1.3 Demo mode (critical for a portfolio)
- **No sign-up wall.** The landing page and a role picker offer one-click buttons: **Try as Dispatcher / Customer / Rider**. Each signs into a seeded demo account.
- The simulator keeps the city alive around the clock, so the dashboard is never empty.
- "Track a demo order" opens a tracking page for an order that is currently in transit.

---

# 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Backend runtime | **.NET 10 (LTS)**, C# 14, ASP.NET Core Web API (controllers) | .NET 11 is STS. Stay on 10 |
| ORM | EF Core 10 + `Npgsql.EntityFrameworkCore.PostgreSQL` 10.0.x + `.NetTopologySuite` plugin | `geography(point)` columns, GiST indexes |
| Database | **PostgreSQL 17 + PostGIS 3.5** (Docker image `postgis/postgis:17-3.5`) | Not plain `postgres`. PostGIS is required |
| Real time | ASP.NET Core **SignalR** (`@microsoft/signalr` on the client) | Groups per role and per order (§3.6) |
| Live state | Redis (official Docker image) | Latest rider positions and the pub/sub backplane |
| Routing / ETA | OSRM (`osrm/osrm-backend`) on an OpenStreetMap extract clipped to Delhi | Phase W9. Straight-line ETA before that |
| Auth | ASP.NET Core Identity + JWT bearer | Tokens, not cookie-only, so the mobile app can reuse them |
| API docs | Built-in OpenAPI (`Microsoft.AspNetCore.OpenApi`) | Generate the TypeScript client from it |
| Frontend | **Angular 22** (signals, zoneless, standalone components), TypeScript, Node 24 LTS | |
| Styling | Tailwind CSS v4 with `@theme` generated from `design-tokens.json` | Tokens only, no default palette |
| Behaviour primitives | Angular CDK + Angular Aria | Overlays, focus traps, listbox, tabs |
| Maps | **MapLibre GL JS** + a custom style JSON matching `map-dark.png` / `map-light.png` | Vector tiles from OpenFreeMap (no key) or MapTiler (free tier) |
| Animation | CSS transitions + View Transitions API; **GSAP + ScrollTrigger** for the landing page only | |
| Icons | Lucide (`lucide-angular`), stroke 2 | Matches the icons in the designs |
| Fonts | Inter + Inter Tight, self-hosted via `@fontsource` | No Google Fonts request at runtime |
| Tests | xUnit, Testcontainers (real PostGIS), Playwright (e2e + screenshots), k6 (load) | |
| Delivery | Docker Compose, GitHub Actions | |

---

# 3. Architecture

## 3.1 System overview
```
 Angular app (landing · dispatch · track · rider)
      │  REST /api/v1 (JWT)            ▲ SignalR /hubs/live
      ▼                                │
 ASP.NET Core API ── Assignment service ── Simulator (BackgroundService, 2 s tick)
      │            ── ETA service ─────── OSRM (phase W9)
      ├── PostgreSQL + PostGIS  (orders, riders, restaurants, events)
      └── Redis                  (live positions, SignalR backplane)
```

## 3.2 Repository layout
```
dispatchly/
├─ CLAUDE.md · PLAN.md · design-tokens.json · designs/
├─ docker-compose.yml
├─ src/
│  ├─ Dispatchly.Api/            controllers, SignalR hub, auth, OpenAPI
│  ├─ Dispatchly.Application/    use cases: PlaceOrder, AssignRider, ConfirmPickup...
│  ├─ Dispatchly.Domain/         entities, enums, domain rules (no EF, no HTTP)
│  ├─ Dispatchly.Infrastructure/ EF Core, PostGIS queries, Redis, OSRM client
│  └─ Dispatchly.Simulator/      BackgroundService + city scenario (hosted by Api)
├─ tests/
│  ├─ Dispatchly.UnitTests/
│  └─ Dispatchly.IntegrationTests/   Testcontainers PostGIS, concurrency tests
├─ web/                          Angular 22 app
│  └─ src/app/
│     ├─ core/        api client (generated), auth, live (SignalR) service
│     ├─ ui/          design-system components (§4.3) + /styleguide route
│     ├─ map/         MapLibre wrapper, style JSON, marker layers, interpolation
│     ├─ landing/  dispatch/  track/  order/  rider/
└─ load/                         k6 scripts
```

## 3.3 Data model
| Entity | Key fields |
|---|---|
| **Rider** | Id, Name, Phone, Vehicle, Plate, Status (`Offline, Available, Assigned, AtRestaurant, Delivering`), Location `geography(point)` + GiST, Bearing, LastSeenAt, OnlineSince, DeliveriesToday |
| **Restaurant** | Id, Name, Area, Address, Location + GiST, PrepMinutes |
| **Customer** | Id, Name, Phone, SavedAddresses |
| **Order** | Id, Code (`DL-4817`), RestaurantId, CustomerId, RiderId?, Status (`Searching, Assigned, PickedUp, InTransit, Delivered, Cancelled`), DropLocation, DropAddress, Items (jsonb), TotalPaise (integer, never float), Payment, DeliveryCode (4 digits), PromisedBy, RouteGeometry `geography(linestring)`, DistanceMeters, CreatedAt / AssignedAt / PickedUpAt / DeliveredAt, row version (`xmin`) |
| **OrderEvent** | Id, OrderId, Type, At, Data (jsonb). Drives the timelines in the UI |
| **User** | Identity user + Role (Dispatcher / Customer / Rider) + link to RiderId / CustomerId |
| **Zone** (W9) | Id, Name, Polygon. Limits the assignment search area |

"Running late" is **derived, not stored**: an order is late when its current ETA is after `PromisedBy`.

**Status → UI label mapping** (labels must match the designs):

| Status | Chip | Chip style |
|---|---|---|
| `Searching` | Needs rider | orange outline + dot |
| `Assigned` / `AtRestaurant` | Assigned | blue tint |
| `PickedUp` | Picked up | orange tint |
| `InTransit` | On the way | orange tint |
| late (derived) | Running late | red tint |
| `Delivered` | Delivered | neutral |

## 3.4 API (`/api/v1`, JSON, JWT)
| Method + path | Who | Purpose |
|---|---|---|
| `POST /auth/demo` `{role}` | anyone | One-click demo sign-in, returns a JWT |
| `GET /live/snapshot` | dispatcher | All riders, active orders and stats for the first paint |
| `GET /live/public` | anyone | Read-only rider positions + headline stats for the landing hero (no personal data) |
| `GET /orders?status=&late=` | dispatcher | Order queue |
| `GET /orders/{code}` | owner / dispatcher | Order, rider, route, timeline |
| `POST /orders` | customer | Place an order (returns `Searching`) |
| `POST /orders/{code}/reassign` | dispatcher | Send the order to the next nearest rider |
| `GET /restaurants?near=` | customer | Restaurants near a point |
| `PUT /rider/status` `{online}` | rider | Go online or offline |
| `GET /rider/task` | rider | Current task, or none |
| `POST /rider/task/pickup` | rider | Confirm pickup |
| `POST /rider/task/deliver` `{code}` | rider | Confirm delivery with the customer's code |
| `POST /rider/location` | rider (mobile) | Real GPS later. The simulator writes directly |
| `GET /stats/live`, `GET /stats/analytics` | dispatcher | Top-bar stats and the analytics page |

## 3.5 Assignment algorithm (the main interview talking point)
1. A placed order gets status `Searching`, and the UI shows "Needs rider · Searching within 1.5 km".
2. In **one transaction**, find `Available` riders within the radius of the restaurant, ordered by distance with PostGIS KNN (`<->` on the GiST index). Lock the first free row with **`FOR UPDATE SKIP LOCKED` `LIMIT 1`**. Set the rider to `Assigned` and the order to `Assigned`, write an `OrderEvent` ("Nearest of N free riders, X km away"), and commit.
3. If nobody is free, a background worker retries every 5 s, widening the radius 1.5 → 3 → 5 km. The UI text tracks the current radius.
4. Then publish over SignalR: the dispatch group, the customer's order group and the rider's group.
5. **Proof:** an integration test fires 50 orders at the same moment against 20 free riders. No rider ends up with two orders, and every order is either assigned or searching.

## 3.6 Real-time contract (SignalR hub `/hubs/live`)
| Group | Who joins | Messages |
|---|---|---|
| `dispatch` | dispatchers | `riders:batch` (every 2 s: compact array `[id, lat, lng, bearing, status]`), `order:changed`, `stats:changed` |
| `public` | landing-page visitors (no auth) | `riders:batch` without names or order details, `stats:changed` |
| `order:{code}` | that customer | `rider:position` (only their rider), `order:changed`, `eta:changed` |
| `rider:{id}` | that rider | `task:assigned`, `task:changed` |

- Batch rider positions into **one message per 2 s tick**, never one message per rider.
- Include a server timestamp so clients can interpolate (§6.2).
- Reconnect with backoff. On reconnect, refetch the snapshot and then resume.
- Document the contract in `docs/realtime.md`. The mobile app reuses it unchanged.

## 3.7 Simulator (`BackgroundService`, 2 s tick)
- **Seed:** ~140 riders, ~40 restaurants in real Delhi areas (§12), and demo customers. A fixed random seed makes demos repeatable.
- **Movement:** riders follow their route polyline at 18–28 km/h with small noise. Idle riders drift slowly near restaurant clusters.
- **Orders:** random arrivals, busier at lunch and dinner. The rate is configurable, as is a speed multiplier for demos.
- **Lifecycle:** prep time → pickup → transit → delivery. A few delays are injected so "Running late" appears. Riders occasionally go offline.
- **Ownership:** the simulator only calls the same application services as real users. It never writes to tables directly, so the assignment logic is exercised for real.

## 3.8 ETA
- **Before W9:** remaining route distance ÷ average speed + remaining prep time.
- **W9:** OSRM route duration, refreshed when the rider moves more than 150 m from the planned route.
- **Smoothing:** the displayed ETA moves by at most 1 minute per update unless the change is over 3 minutes. ETAs never jitter.

---

# 4. Design system → code

## 4.1 Tokens
- Generate `web/src/styles/tokens.css` (Tailwind v4 `@theme`) from `design-tokens.json` with a small script, so there's one source of truth.
- Dark ops screens (dispatch, rider) and light customer screens (tracking, order) are **themes on the same tokens**, not separate stylesheets.
- `font-variant-numeric: tabular-nums` on every number.

## 4.2 Map style
- Write `web/src/app/map/style-dark.json` and `style-light.json` (MapLibre style spec) to match `designs/screenshots/map-dark.png` and `map-light.png`:
  - background = land
  - minor streets thin and barely visible
  - arterials and the ring road with casings
  - parks and water from tokens
  - labels in uppercase Inter 600, letter-spacing 0.12em, with a halo in the land colour
  - no POI icons and no clutter
- Host the style JSON with the app. The mobile app uses the same files.
- **Riders are GeoJSON sources drawn as `circle` and `symbol` layers, not DOM markers.** That's what keeps it at 60 fps with 500 riders.
- Layer order, bottom to top: routes of other riders → active route glow → active route → restaurants → drops → riders → selected rider halo → selected rider → label pill.

## 4.3 Component inventory (build these first, on `/styleguide`)
| Component | Spec (from the designs) |
|---|---|
| Button: primary | orange fill, ink text, pill, 16/600, 14×24 padding |
| Button: secondary / outline | dark raised fill, or a 1px 16% white border, pill or 12–14px radius, 44–48px tall |
| Icon button | 32–44px, round or 12px radius, always has `aria-label` |
| Status chip | 12/600, pill, tint background + status text colour (§3.3 mapping) |
| Panel (on map) | 94% panel colour, 1px 7% white border, 18px radius, `panelOnMap` shadow |
| Segmented control | input-coloured track, 3px padding, active segment raised |
| Search field | 40px, input colour, search icon, `Ctrl K` / `⌘K` key hint |
| Order row | ID + chip / restaurant → area (ellipsis) / rider + ETA; selected row is raised with a 12px radius |
| Rider card | avatar initials, name, vehicle + plate, chip, big ETA, progress bar, timeline, stats, 2 actions |
| Timeline | 10px dots, done = orange, current = orange ring with halo, pending = grey ring; connecting line |
| Segmented progress | 4 segments with a 4px gap, the current one partly filled |
| ETA block | "Arriving in" label + display number + time/distance aligned right |
| Bottom sheet | 28px top radius, grabber, drag to snap (peek / half / full) |
| Slide to confirm | 64px track, 54px orange knob, chevron hint; fires at 85% of the travel |
| Stat | number + label (top bar: 17/600 + 12px label; landing: 44px display) |
| Legend | coloured dots with counts |
| Map controls | layers, recenter, zoom (+/− stacked) |
| Map markers | exactly as `design-tokens.json → marker` |
| Wordmark | ring + orange dot mark + "Dispatchly" in Inter Tight 700 |

**Done when** `/styleguide` shows every component in every state (default, hover, pressed, focus, disabled, loading) in dark and light, at 1440 and 390 px.

---

# 5. Screen specs

Each screen = its design + the behaviour below. Sample values in the designs (names, numbers) come from real data. Everything else stays the same.

## 5.1 Landing `/` (design: `landing.png`)
**Sections in order:**
1. Nav
2. Hero: pill, three-line headline, lead text, 2 CTAs
3. **Live map frame** with three chips: riders, new order, tracking card
4. Live stats strip
5. How it works (4 steps)
6. Smart assignment (text + map diagram)
7. Three views (device frames)
8. Tech specs
9. "See it move" CTA
10. Footer

**Live data:**
- The hero map is a *real* MapLibre map (dark style, non-interactive, slow ambient camera drift) with live riders from SignalR, visible to visitors without signing in.
- The stats strip is live.
- The tracking card follows a real in-transit order.
- If the API is unreachable, fall back to a recorded 60-second loop so the hero is never empty.

**Motion:**
- Headline lines rise and fade in one after another (60 ms apart, 600 ms, `enter` easing).
- The map frame scales 0.96 → 1 and fades in on load.
- Stats count up when they scroll into view.
- Steps reveal in order, and each connector line draws left to right.
- In the assignment diagram the rings expand outward, then the chosen rider's line draws and the "Assigned" chip pops in.
- The device frames rise with gentle parallax.
- All of this is GSAP ScrollTrigger. It runs once, never loops while you read, and is disabled under reduce-motion.

**Responsive:**
- At ≤ 768 px the hero map is 420px tall and its bottom-left toast is hidden.
- The stats become a 2×2 grid, the steps stack, the assignment map sits below the text, and the devices scale down.
- At ≤ 480 px only the phone frames are shown.
- Use `text-wrap: balance` on all headings (§11).

## 5.2 Dispatcher dashboard `/dispatch` (design: `dashboard.png`)
**Regions:** full-bleed dark map · top bar (wordmark, city switcher, search, Live indicator, 4 stats, account) · Orders panel (left, 372px) · selected rider card (right, 348px) · legend (bottom left) · map controls (bottom right).

**Behaviour:**
- **Orders queue:**
  - Sorted with Needs rider first, then Running late, then by ETA.
  - New orders slide in at the top (FLIP animation, 280 ms) and briefly highlight.
  - Delivered orders fade out after 3 s.
  - The tabs filter All / Needs rider / Late, and their counts update live.
- **Selection:**
  - Clicking an order or rider selects both: the row is highlighted, the camera flies to the rider (800 ms) and the rider card slides in from the right (280 ms).
  - Esc closes the card.
  - The selection survives live updates.
- **Selected rider on the map:** halo, active route with the travelled part dotted, the name/ETA pill follows the marker, and the drop pin is shown.
- **Needs rider on the map:** an orange square with expanding rings (a 2 s pulse, the only looping animation on the screen).
- **Search (`Ctrl K` / `⌘K`):** a command palette for riders, orders and areas. Arrow keys plus Enter fly to the result.
- **Actions:**
  - Call rider opens a `tel:` link.
  - Reassign shows a confirmation popover listing the next 3 nearest free riders with distances, then animates the change.
- **Top bar stats tick** to new values. "Running late" turns red when above 0.
- **Live indicator:** `Live · updated Ns ago`. If disconnected for more than 5 s it shows grey "Reconnecting…", markers dim to 50% after 10 s, and a toast appears on recovery.

**States:**
- Loading: the map background shows first, markers fade in, and the panel shows 6 skeleton rows.
- No orders in a tab: one quiet line, e.g. "Nothing needs a rider right now."
- API error: an inline retry in the panel. The map keeps showing the last data.

**Keyboard:** `↑` / `↓` move through orders, `Enter` selects, `Esc` closes, `/` or `Ctrl K` searches, `+` / `−` zoom.

**Responsive:**
- At ≥ 1280 px: as designed.
- At 1024–1279 px: the rider card becomes an overlay drawer.
- Below 1024 px: the Orders panel becomes a bottom sheet over the full-screen map and the top-bar stats collapse into the Live chip.

## 5.3 Customer tracking `/track/:code` (design: `tracking.png`)
**Regions:** full-screen light map with the route · floating back / order code / help buttons · recenter button · bottom sheet (ETA, 4-step progress, status sentence, rider card, delivery code, order summary).

**Behaviour:**
- **ETA:** the number ticks when it changes, never jumps by more than 1 minute per update (§3.8), and "8:05 PM" updates alongside it.
- **Route:** the active part shrinks as the rider moves and the travelled part turns dotted grey. The camera keeps the rider and the drop pin in view with padding for the sheet, re-framing smoothly at most every 5 s unless the user has panned. After the user pans, the recenter button appears.
- **Status sentence** is written for humans and changes per state:
  - "Finding the nearest rider…"
  - "Aman is heading to Saffron & Smoke"
  - "Aman picked up your order at 7:51 PM and is riding down Mathura Road."
  - "Aman is around the corner"
  - "Delivered at 8:04 PM"
- **Progress segments** fill with a 600 ms ease. The current segment fills smoothly with distance progress.
- **Bottom sheet** drags between peek (the ETA only) and full. It snaps with a spring and the map padding follows.
- **Delivered state:** the sheet becomes a delivered summary with the time and a "Rate your delivery" row (designed from existing components, §5.5). The ETA area shows a check animation, once.
- **Announce key changes politely to screen readers:** "Picked up", "Arriving in 2 minutes", "Delivered".

**States:** searching for a rider (radar pulse around the restaurant on the map, "Finding the nearest rider…"), rider assigned (heading to the restaurant), picked up, on the way, delivered, cancelled, order not found, connection lost (the last known position is shown with "Updating…").

**Responsive:** designed at 390 px and supports 360–430 px. On desktop the sheet becomes a 400px floating panel on the left over a full-width map.

## 5.4 Rider app `/rider` (design: `rider.png`)
**Regions:** full-screen dark map · earnings pill · Online toggle · bottom sheet with the current task.

**Behaviour:**
- **Online toggle:** the switch animates over 160 ms. Going offline dims the map and the sheet reads "You're offline. Go online to get orders."
- **Waiting state** (online, no task): "Waiting for orders near you" with a slow radar ring around the rider.
- **New task arrives:** the sheet rises with a spring and the device vibrates where supported (phone only). The route draws from the rider to the restaurant.
- **Pickup step** (as designed): the restaurant, address, a "Ready in N min" chip that counts down, items, the drop preview, Call café / Navigate (opens Google Maps directions), and **Slide to confirm pickup**.
- **Slide to confirm:**
  - The knob follows the finger or mouse.
  - Releasing before 85% springs it back.
  - At 85% it snaps to the end, turns into a check, and the sheet transitions to the Drop step.
  - The keyboard alternative is focus plus Enter held for 600 ms with a visible progress ring.
- **Drop step:** the customer's first name, the address, "Ask for the delivery code", a 4-digit code input, and **Slide to confirm delivery**. A wrong code makes the input shake (once, 300 ms) and shows an inline error.
- **After delivery:** an earnings increment animates (e.g. "+₹48") and the screen returns to waiting.

**States:** offline, waiting, task assigned, at restaurant, picked up, delivering, delivered, error (action failed: the slider resets and an inline message explains).

## 5.5 Screens not in the designs: build from the system, then get approval
| Screen | Build from |
|---|---|
| Demo role picker (modal on the landing page) | Panel, three large buttons with an icon, title and one-line description |
| Order placement `/order` (customer) | Light map + bottom sheet. Restaurant list rows (order-row style), drop-pin step, summary + primary "Place order" button |
| Tracking: delivered and cancelled states | Same sheet, ETA block replaced with a check plus a summary |
| Analytics `/dispatch/analytics` | Dark panels, 3–4 charts (delivery time distribution, orders per hour, rider utilisation) in token colours, no chart junk |
| 404 / error page | Landing typography: "This page took a wrong turn." + a button home |
| Rider drop step | Same as the pickup sheet with different fields (§5.4) |

**Rule:** for each of these, show screenshots at 1440 and 390 px and wait for approval before the polish pass.

---

# 6. Motion and interaction spec (the "rich experience")

## 6.1 Global rules
- **Durations and easings come only from `design-tokens.json → motion`.**
- Animate only `transform` and `opacity` in the DOM. Do map animation inside MapLibre.
- Use the View Transitions API between routes: a 220 ms crossfade, and shared elements (wordmark, ETA number) morph.
- **Pressed state:** `scale(0.98)` for 100 ms on every button and row.
- **Hover:** a slightly lighter surface only. No lifts, no glows.
- **Focus:** a 2px orange outline with a 2px offset, on every interactive element.
- **`prefers-reduced-motion`:** no camera flights (jump instead), no count-ups, no parallax. Rider positions still update but without easing, and the needs-rider pulse becomes a static ring.

## 6.2 Rider marker motion (the heart of the experience)
- The server sends positions every 2 s. The client keeps the last two positions for each rider and **renders 2 s behind real time, interpolating** between them on `requestAnimationFrame`. Movement is perfectly continuous, with no teleporting.
- Bearing eases along the shortest angle over 300 ms.
- If an update is late, extrapolate for at most 1 s, then hold. Never let a marker run off its road.
- Update the GeoJSON source at up to 60 fps. If profiling shows dropped frames with 500 riders, drop to 30 fps for non-selected riders and keep 60 fps for the selected one.
- Status changes cross-fade the marker colour over 220 ms.

## 6.3 Interaction table
| Interaction | Motion |
|---|---|
| Select rider/order | camera `flyTo` 800 ms + rider card slides in 280 ms (`enter`) |
| New order in queue | row slides in from the top (FLIP 280 ms) + a 1.2 s background highlight fade |
| Order leaves queue | fade + collapse height, 220 ms |
| Number change (stats, ETA, earnings) | vertical digit roll, 400 ms, tabular figures |
| Status chip change | crossfade colours + label, 220 ms |
| Progress bar / segments | width ease, 600 ms |
| Bottom sheet | drag-follow, spring snap (`spring.sheet`) |
| Slide to confirm | drag-follow, spring back (`spring.slideToConfirm`), success check 300 ms |
| Toasts | slide up 220 ms, auto-dismiss 4 s, at most 2 on screen |
| Needs-rider pulse | rings expand and fade, 2 s loop (the only infinite animation) |
| Loading skeletons | opacity 1 → 0.5 → 1 over 1.2 s, only while loading (the one approved exception to the rule above); static under reduced motion |
| Landing reveals | §5.1, GSAP, once per element |

## 6.4 Performance budgets
- **Dashboard:** 60 fps with 500 riders (check with the Chrome Performance panel) and INP < 200 ms.
- **Landing:** LCP < 2.5 s on 4G, CLS < 0.05, and Lighthouse Performance ≥ 90.
- **Bundle splitting:** lazy-load each route. MapLibre and GSAP load only on the routes that need them.

---

# 7. Web build phases

Each phase ends with its **"done when"** check. UI phases also pass the fidelity loop (§0.4).

| # | Phase | Deliverables | Done when |
|---|---|---|---|
| W0 | Setup | Repo, solution and projects, Angular app, Docker Compose (PostGIS, Redis), CI building both, CLAUDE.md + this pack committed | `docker compose up` runs, CI is green |
| W1 | **Design system + map style** | tokens.css generated from JSON, fonts, icons, every §4.3 component, `/styleguide`, both MapLibre styles | The styleguide matches the designs in dark and light at 1440 and 390, and the map screenshots match `map-*.png` closely |
| W2 | Backend core | Entities, migrations, seed (§12), assignment service (§3.5), REST endpoints, JWT bearer + `POST /auth/demo` (moved from W8, approved 2026-11-26), OpenAPI → generated TS client | The 50-concurrent-orders test passes, and every endpoint is covered by integration tests |
| W3 | Simulator + real time | BackgroundService (§3.7), SignalR hub and groups (§3.6), snapshot endpoint | A test client sees `riders:batch` every 2 s, and orders complete on their own |
| W4 | **Dispatcher dashboard** | §5.2 complete with interpolation (§6.2) | Matches `dashboard.png`, 60 fps with 500 riders, every state and keyboard shortcut works |
| W5 | **Customer flow** | Order placement (§5.5, approved first) + tracking (§5.3) | Matches `tracking.png`, the full order-to-delivery flow works on a phone |
| W6 | **Rider app** | §5.4 incl. drop step + slide to confirm | Matches `rider.png`, the full pickup → delivery flow works with touch and keyboard |
| W7 | **Landing** | §5.1 with live data and scroll motion | Matches `landing.png`, Lighthouse ≥ 90, works at 360 px |
| W8 | Auth + demo roles | Identity accounts, web role guards, the role picker and one-click demo sign-in in the UI (the API's JWT and `POST /auth/demo` arrive in W2) | Each role sees only its screens, and a new visitor reaches the live demo in 1 click |
| W9 | Realism | OSRM (Delhi-clipped extract) routes + ETAs, Redis live positions + backplane, zones | Riders follow real roads, and ETAs come from routes |
| W10 | **Polish pass** | Every state in §5, reduced motion, a11y audit (axe + keyboard), perf budgets (§6.4), §11 items | Nothing frozen, blank or jumpy anywhere, and every budget is met |
| W11 | Ship | Production Compose, deployment, README (architecture diagram, GIFs, 45 s demo video), k6 load test results | A public link works and the README shows *measured* numbers |

**Order of work:** W1 must be approved before any screen is built. Screens are built one at a time and each is approved before the next starts.

---

# 8. Quality gates (definition of done for every PR)
- [ ] Fidelity loop (§0.4) done, and the screenshot comparison is attached to the PR
- [ ] No hard-coded colours, sizes or durations (search the diff for `#`, `px` outside tokens, and `ms`)
- [ ] Loading, empty, error and offline states implemented
- [ ] Keyboard and focus work, axe shows 0 serious issues, reduced motion is respected
- [ ] Unit/integration tests added. Playwright e2e for any flow touched
- [ ] Works at 360, 390, 768, 1280 and 1440 px
- [ ] No console errors, and the performance budget holds for touched screens

**Visual regression:** once a screen is approved, commit Playwright screenshots of it with the map canvas masked as the baseline. CI then fails on unintended UI changes.

---

# 9. Deployment
- **Services** (Compose): `api` (also hosts the simulator), `web` (static build behind the API or a CDN), `db` (PostGIS), `redis`, `osrm`.
- **The host must not sleep:** the simulator has to keep running or the demo goes stale. Use an always-on container host or a small VPS, with HTTPS and WebSockets enabled for SignalR.
- **OSRM:** clip the OpenStreetMap extract to the Delhi bounding box (osmium) before preprocessing, so memory stays small.
- **Config:** connection strings and the JWT key come from environment variables or secrets. Never commit them.
- **Health:** `/health` endpoints. The simulator restarts itself if it dies.

---

# 10. CV and README output (after W11)
- **README:** live link, a 45 s demo video, an architecture diagram, and the "hard problems" section (assignment locking, 2 s batched real time, interpolation, PostGIS KNN).
- **CV bullets:** only with **measured** numbers from k6 and the concurrency test (riders simulated, updates/sec, p95 latency, 0 double assignments in N concurrent orders).

---

# PART B: Mobile app (starts only after the website is complete and shipped)

## B1. Goal and scope
Native-feeling apps for the two mobile roles, on the **same backend**, with the same design language and the same rich experience:
- **Customer app:** order placement, live tracking, push notifications ("Aman picked up your order").
- **Rider app:** online toggle, tasks, slide to confirm, background location, navigation hand-off.
- The dispatcher stays on the web.

## B2. Recommended stack
| Option | Pros | Cons |
|---|---|---|
| **React Native (Expo, dev build) — recommended** | Smoothest native maps (`@maplibre/maplibre-react-native`, same style JSON), Reanimated for 60 fps gestures, `@gorhom/bottom-sheet`, Expo Location (background), Haptics, Notifications. SignalR JS client works | A second UI framework (React) |
| .NET MAUI | All C# end to end, a strong ".NET full-stack" story | Fewer polished options for custom vector maps and fluid gesture animation |
| Ionic + Capacitor (Angular) | Most code reuse from the web app | WebView feel, harder to hit native smoothness |

Pick in B3. The recommendation is RN/Expo for the experience bar.

## B3. Mobile phases
| # | Phase | Done when |
|---|---|---|
| M0 | Decide the stack, scaffold the app, theme from `design-tokens.json`, fonts, icons | The theme screen matches web tokens |
| M1 | **Mobile designs:** adapt the approved Tracking and Rider designs (already phone-sized) plus the order and onboarding screens on the design canvas, then **approve before building** | Designs approved |
| M2 | Shared core: generated API client, JWT auth, SignalR service, MapLibre with the shared style JSON, marker interpolation ported from web | A live map with smooth riders on a real device |
| M3 | Customer app: order placement, tracking, delivered state, push notifications, deep link `dispatchly://track/:code` | The full flow works on Android and iOS |
| M4 | Rider app: online toggle, background location (`POST /rider/location`), tasks, slide to confirm with haptics, navigation hand-off | The full flow works with the screen off and the phone in a pocket |
| M5 | Polish + release: native bottom sheets, haptics on key moments, reduced motion, app icon/splash in the brand, Play Store internal testing (then App Store if you have an Apple developer account) | A store listing or test link is live |

The same rules apply to mobile: designs are the source of truth, the same anti-slop list, and every state handled.

## B4. Decisions in the web build that keep mobile easy
- **The versioned REST API (`/api/v1`) and the SignalR contract are documented and stable.**
- JWT bearer auth, not cookie-only.
- Business rules live on the server (assignment, ETA, late detection). Clients only display.
- Design tokens and map style JSON are shared files, not hard-coded in Angular.
- The OpenAPI document is generated in CI, and both clients generate from it.
- The rider location endpoint exists from W2 (the simulator path), so real GPS later is a drop-in.

---

# 11. Allowed deviations (the only ones)
These come from reviewing the approved mockups. Fix them as described. Nothing else changes.
1. **Map label collisions:** in the mockups some labels sit under markers or pills (e.g. "LAJPAT NAGAR" under the Home pill, "CONNAUGHT PLACE" under a rider). In MapLibre, give markers and pills priority and let labels hide on collision.
2. **Labels showing through panels:** dashboard panels are 94% opaque, so map labels faintly show through. Use 97% opacity or add `backdrop-filter: blur(12px)` behind panels. The panel colour stays the same.
3. **Long text in tight rows:** the vehicle + plate line in the tracking rider card wraps to two lines at 390 px. Truncate with an ellipsis on one line, with the full text in `title` and `aria-label`.
4. **Heading wraps:** use `text-wrap: balance` on all display headings (e.g. "The nearest free rider. / Every time." currently leaves "rider." alone on a line).
5. **Hand-drawn map → real map:** the designs use a drawn map of Delhi. Production uses real OpenStreetMap vector tiles styled to the same colours and label treatment.
6. **Approved at the end of W1 (2026-11-26):**
   - **Light-theme contrast:** "Running late" text uses `status.lateTextOnLight` (#B42318) and "Assigned" text uses `status.availableTextOnLight` (#2463CF). The focus ring on light surfaces uses `accent.orangeTextOnLight` (`focus.colorOnLight`).
   - **Bottom sheet:** the grabber is a `<button>` that toggles peek and full, with a screen-reader-only label ("Show more" / "Show less"). Focus moving into the sheet still opens it fully.
   - **Order row arrow:** the → between restaurant and area is a Lucide `arrow-right` icon (14px, secondary text colour), because the self-hosted Inter has no → glyph. The ≈ glyph stays as text.
   - **Map credit:** the OpenStreetMap attribution its licence requires, kept small and drawn in the theme's surface and text colours.
   - **Light versions of dark-only components** (panels, segmented control, timeline, disabled text, slide hint), the hover, disabled and loading styles, and pill padding of (height − font size) ÷ 2, as shown on `/styleguide`.

---

# 12. Sample data canon (seed + demo)
Use these so the product feels real and consistent with the designs:
- **Hero order:** `#DL-4817` · Saffron & Smoke, Khan Market → B-14, Lajpat Nagar II · rider **Aman Verma** (Honda Activa · DL 3S CK 2041) · 2 items · ₹640 · delivery code 4821.
- **Other riders:** Ritika Sharma, Imran Ali, Neha Gupta, Karan Mehta + generated Indian names.
- **Restaurants** (invented names in real areas): Saffron & Smoke (Khan Market), Momo Lab (Hauz Khas), Kulfi & Co. (Connaught Place), Lahori Gate Kitchen (Daryaganj), Second Pour Café (Main Bazar, Paharganj), Tiffin Theory (Sundar Nagar), Masala Mill (Lodhi Colony). Do not use real restaurant brands.
- **Areas:** Connaught Place, Paharganj, Karol Bagh, Daryaganj, Chanakyapuri, India Gate, Lodhi Colony, Lajpat Nagar, Hauz Khas, Green Park, Gole Market, Nizamuddin East, Laxmi Nagar.
- **Money** in ₹, stored as integer paise. **Time** in 12-hour format ("8:05 PM").
- The footer says riders, restaurants and orders are simulated. Keep that line.
