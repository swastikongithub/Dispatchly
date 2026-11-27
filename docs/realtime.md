# Dispatchly real-time contract

The web app and the mobile app (PLAN.md Part B) both rely on this contract. Changing it needs approval (CLAUDE.md).

## Contents

- [Connecting](#connecting)
- [Joining groups](#joining-groups)
- [Messages](#messages)
- [Payloads](#payloads)
- [Snapshots](#snapshots)
- [Recovery: snapshot first, then newer messages](#recovery-snapshot-first-then-newer-messages)
- [Notes](#notes)

## Connecting

SignalR hub: **`/hubs/live`**, served by the API (for example `http://localhost:5080/hubs/live`).

- JSON protocol. Names are camelCase and enums are names (`"Delivering"`), as in the REST API. Times are ISO 8601 in UTC.
- Pass the JWT from `POST /api/v1/auth/demo` as **`?access_token=<jwt>`**. Browsers can't set headers on a WebSocket, so the hub reads the token from the query string (only on `/hubs/live`). With the JS client, use `accessTokenFactory`, which does this for you.
- No token is needed to connect. Each group checks who is asking when you join it.
- When the token expires, the server closes the connection. Sign in again and reconnect.

```ts
const connection = new HubConnectionBuilder()
  .withUrl("/hubs/live", { accessTokenFactory: () => token })
  .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
  .build();
```

## Joining groups

Joining is a call from the client to the server. A new connection is in no group, and that includes a reconnect. So **call your `Join…` again every time you connect or reconnect.**

| Call               | Who may call it                    | Group          |
| ------------------ | ---------------------------------- | -------------- |
| `JoinPublic()`     | anyone, signed in or not           | `public`       |
| `JoinDispatch()`   | dispatcher                         | `dispatch`     |
| `JoinOrder(code)`  | the customer who placed that order | `order:{code}` |
| `LeaveOrder(code)` | anyone; does nothing if not joined | —              |
| `JoinRider()`      | rider                              | `rider:{id}`   |

A refused join fails the call with a `HubException`. The client's error message ends with the reason:

| Reason         | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `unauthorized` | No valid token. Sign in (again) and reconnect.                              |
| `forbidden`    | Signed in, but this group is for another role.                              |
| `not_found`    | `JoinOrder` only: no such order, or not yours. These look alike on purpose. |

The JS client rejects with an `Error` whose message reads `An unexpected error occurred invoking 'JoinOrder' on the server. HubException: not_found`. Check the end of the message with `message.endsWith('HubException: not_found')`.

## Messages

All messages go from the server to the client.

- **Every message carries the server time it was built at, `at`.**
  - Real-time-only payloads carry it inside the payload.
  - Messages whose payload is a REST record carry it as a second argument. Their handler takes `(payload, at)`.
- Send times are approximate. "Every 2 s" means one message per tick for the whole group, never one per rider.

| Message          | Group                | Arguments             | When                                                                                                                            |
| ---------------- | -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `riders:batch`   | `dispatch`, `public` | `RidersBatch`         | Every 2 s, with every rider on shift.                                                                                           |
| `stats:changed`  | `dispatch`, `public` | `LiveStats`, `at`     | When any number changes. Checked every 2 s.                                                                                     |
| `order:changed`  | `dispatch`           | `OrderSummary`, `at`  | When an order is placed, assigned, reassigned, picked up, on the way or delivered, or its shown ETA minute or lateness changes. |
| `order:changed`  | `order:{code}`       | `OrderDetails`, `at`  | When the order is assigned, reassigned, picked up, on the way or delivered. Includes `deliveryCode`.                            |
| `rider:position` | `order:{code}`       | `RiderPosition`       | Every 2 s while the order has a rider.                                                                                          |
| `eta:changed`    | `order:{code}`       | `EtaChanged`          | When the ETA moves to another minute, or lateness changes. Also sent the first time an order is seen after a restart.           |
| `task:assigned`  | `rider:{id}`         | `RiderTaskView`, `at` | When the rider gets a new order, by assignment or reassignment.                                                                 |
| `task:changed`   | `rider:{id}`         | `RiderTaskView`, `at` | When the rider's task changes. `task` is `null` when it was delivered or reassigned away.                                       |

`OrderSummary`, `OrderDetails`, `RiderTaskView` and `LiveStats` are exactly what the REST API returns (`GET /orders`, `GET /orders/{code}`, `GET /rider/task`, `GET /stats/live`). The OpenAPI document has their schemas.

The `public` group never gets names, phone numbers, order codes or order details: it gets positions, statuses and the city's aggregate numbers.

## Payloads

### `riders:batch`: `RidersBatch`

```json
{
  "at": "2026-11-27T07:30:02.004Z",
  "riders": [
    [17, 28.60031, 77.22702, 184, "Delivering"],
    [18, 28.5679, 77.2436, 0, "Available"]
  ]
}
```

- Each rider is a `RiderPoint`: the array `[id, lat, lng, bearing, status]`. That keeps a batch of 500 riders small.
  - `lat` and `lng` are rounded to 5 decimals, about 1 m.
  - `bearing` is a whole number of degrees, 0–359, clockwise from north.
  - `status` is `Available`, `Assigned`, `AtRestaurant` or `Delivering`.
- Every rider on shift is in every batch. **A rider missing from a batch went offline.** Remove them from the map.
- Interpolate each marker from where it is towards the new position over the next ~2 s (PLAN.md §6.2), using `at` to pace it.

### `stats:changed`: `LiveStats`, `at`

```json
{
  "ridersOnline": 142,
  "ridersFree": 84,
  "ridersOnDelivery": 58,
  "activeOrders": 61,
  "needsRider": 3,
  "runningLate": 4,
  "averageDeliveryMinutes": 27,
  "deliveredToday": 412
}
```

`averageDeliveryMinutes` is from placed to delivered over the last hour. It is `null` when nothing was delivered in that hour. `deliveredToday` counts from midnight in Delhi.

### `rider:position`: `RiderPosition`

```json
{
  "at": "2026-11-27T07:30:02.004Z",
  "code": "DL-4817",
  "riderId": 17,
  "location": { "lat": 28.600312, "lng": 77.227021 },
  "bearing": 184.2,
  "remainingMeters": 2140
}
```

`remainingMeters` is the straight-line distance the rider still has to cover. Before pickup, that is via the restaurant.

### `eta:changed`: `EtaChanged`

```json
{
  "at": "2026-11-27T07:30:02.004Z",
  "code": "DL-4817",
  "estimatedDeliveryAt": "2026-11-27T07:52:40Z",
  "isLate": true,
  "minutesLate": 3
}
```

The server decides the ETA and lateness. Show them as they come, and don't work them out on the client.

## Snapshots

A client starts from a snapshot and then applies messages on top of it. Snapshots are REST calls under `/api/v1`.

| Method | Path                    | Who        | Returns                                                                                               |
| ------ | ----------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/live/snapshot` | dispatcher | `{ at, riders: LiveRider[], orders: OrderSummary[], stats: LiveStats, restaurants: RestaurantPin[] }` |
| GET    | `/api/v1/live/public`   | anyone     | `{ at, riders: RiderPoint[], stats: LiveStats }`                                                      |

- `GET /live/snapshot` returns:
  - every rider on shift, each with name, vehicle, plate, phone, status and `deliveriesToday` (since midnight in Delhi), plus `orderCode` when the rider is on an order
  - the order queue, in the same order as `GET /orders`. Each `OrderSummary` carries what the map draws: `restaurantId`, `restaurantLocation`, `dropLocation` and the `route` from restaurant to drop. `order:changed` to `dispatch` carries the same fields.
  - the same stats as `GET /stats/live`
  - every restaurant (`id`, `name`, `area`, `location`), for the map's restaurant pins
- Riders who come on shift after the snapshot appear in `riders:batch` with a position and status only. Fetch the snapshot again to get their names.
- `GET /live/public` returns what the landing page needs: positions as `RiderPoint` arrays, and the stats.
- The other screens start from their own REST call:
  - the customer's tracking page: `GET /orders/{code}`
  - the rider app: `GET /rider/task`

## Recovery: snapshot first, then newer messages

Do the same thing on first load and after every reconnect:

1. **Connect, register your handlers and join your groups.** From here on, buffer the messages that arrive.
2. **GET the snapshot** (or the screen's REST call) and render it.
3. **Apply the buffered and later messages, but only those whose `at` is newer than the snapshot's.** For `GET /orders/{code}` and `GET /rider/task`, which have no `at`, use the time you sent the request.

Joining before the GET means nothing is missed between them. The `at` check drops what the snapshot already includes.

Messages can arrive out of order across entities, so keep the latest `at` you applied for each entity and drop anything older:

- per order code for `order:changed`, `rider:position` and `eta:changed`
- per rider for the task messages
- once for `riders:batch` and once for `stats:changed`

While reconnecting, keep the last state on screen with the reconnecting state from the designs. Don't clear it. `withAutomaticReconnect` handles the backoff. If it gives up, keep retrying more slowly with a fresh token.

## Notes

- **Ticks:** the server ticks every 2 s (`Live:BatchInterval`). One tick sends:
  - one `riders:batch`
  - one `rider:position` per active order with a rider
  - any `eta:changed`
  - `stats:changed` if the numbers changed
- **Publishing:**
  - Changes are published after the database commit, built from a fresh read.
  - A failure to publish is logged and never fails the REST call that caused it. Reconnecting and re-reading the snapshot recovers from anything missed.
- **The rider app's own position:**
  - The `rider:{id}` group gets task messages only. The rider app shows its own GPS position.
  - The rider app reports that position with `POST /rider/location`. `task:changed` brings the server's view (for example, "At restaurant" when the rider arrives).
- **Several API instances:** with more than one API instance, add a SignalR backplane (Redis, PLAN.md §3) so a message reaches clients connected to any instance. The city simulator must run on one instance only.
