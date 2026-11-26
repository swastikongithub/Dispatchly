# Dispatchly — instructions for Claude Code

Dispatchly is a live delivery dispatch and tracking platform: ASP.NET Core (.NET 10) API, Angular 22 web app, PostgreSQL + PostGIS, SignalR. The full plan is in `PLAN.md`. Read the matching section before starting any task.

## The approved designs are the source of truth. Follow them strictly.
- Visual target: `designs/screenshots/*.png`. Exact values: `designs/html/*.html`. When they disagree, the HTML wins.
- Every colour, font size, radius, shadow, spacing and motion value comes from `design-tokens.json`. Never hard-code a value that isn't there, and never invent a new one.
- design-tokens.json must mirror the approved HTML exactly. Adding a token for a value that already appears in the approved HTML doesn't need my approval. Values specified in PLAN.md count as approved too, so they can be added as tokens without asking. Only changing an existing value or inventing a new one needs my approval.
- Copy is part of the design. Use the exact labels and microcopy from the designs. Only sample data (names, numbers) is replaced by real data.
- Don't add UI kits (Angular Material, PrimeNG, Bootstrap, DaisyUI, Spartan, shadcn-style). Build components from the designs on Angular CDK/Aria.
- Only the deviations in `PLAN.md` §11 are allowed. If something in a design looks wrong, **ask** instead of changing it.
- For anything not in the designs (PLAN.md §5.5): build it only from existing components and tokens, show screenshots at 1440 and 390 px, and **wait for approval**.

## Experience bar
- Nothing jumps. Riders interpolate between updates, numbers roll, panels and sheets animate, the camera flies. Follow PLAN.md §6.
- 60 fps on the dashboard with 500 riders. Rider markers are MapLibre GeoJSON layers, never DOM markers.
- Every screen implements its loading, empty, error, reconnecting and finished states.
- Keyboard and focus visible everywhere, 4.5:1 contrast, `prefers-reduced-motion` respected, works from 360 to 1920 px.

## Never
Purple/blue gradients, gradient text, glassmorphism everywhere, neon glows, emoji as icons, stock illustrations, "hero + 3 feature cards", fake testimonials or stats, lorem ipsum, default Material/Bootstrap/Tailwind-palette looks, coloured left-border cards, a second accent colour.

## Workflow for every UI task
1. Open the matching PNG and HTML design.
2. Build with tokens and shared components from `web/src/app/ui`.
3. Take a Playwright screenshot of the built screen at the design viewport (1440×900, or 390×844 for phones).
4. List every difference from the design and fix it. Repeat until only §11 deviations remain.
5. Check motion, states, keyboard and responsive behaviour, then commit.
6. In your summary, state which differences remain (if any) and why.

## Workflow for every backend task
- Business rules live on the server (assignment, ETA, late detection). Clients only display.
- The assignment path must stay concurrency-safe (`FOR UPDATE SKIP LOCKED`). Keep the 50-concurrent-orders test passing.
- The REST API stays under `/api/v1` and the SignalR contract in `docs/realtime.md`: the mobile app (PLAN.md Part B) depends on both.

## Ask first before
Adding a dependency, changing a token, adding a screen or a new visual pattern, changing the API or real-time contract, or deviating from a design.
