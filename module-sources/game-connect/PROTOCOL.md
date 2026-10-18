# The game-connect protocol, version 1

How a game server talks to a Blysis site. Any game can speak it: the Minecraft plugin is the
first client, and a Rust, FiveM, Hytale or Roblox client can be written from this page alone.

The game server opens every connection. Nothing listens on the game server, no port is opened,
and the site's database never leaves the site.

## Conventions

- Every path is under `https://<site>/api/v1/game-connect/`.
- Every request carries two headers:
  - `Authorization: Bearer <token>`. A token is `gc_` followed by 43 base64url characters. The
    site shows it once when it is made and keeps only its SHA-256.
  - `X-Game-Connect-Protocol: 1`.
- Bodies are JSON, UTF-8. Every answer is JSON, except `204`.
- Times are ISO 8601 strings in UTC. Amounts of credits are numbers with at most two decimals.
- A client sends `instance` on every call after `hello`: the id it chose for this process, a
  UUID made fresh on every start.
- A client must set a connect timeout and a request timeout on every call. The long-poll's
  request timeout must be longer than `pollHoldSeconds`.

### A player

```json
{ "id": "069a79f4-44e9-4726-a5be-fca90e38aaf5", "name": "Notch" }
```

`id` is the player's stable id in the game: a UUID in Minecraft, a SteamID64 in a Steam game, a
UserId in Roblox. `name` is the name shown now. The platform is the server's `game`, sent once in
`hello`.

### Errors

Every error answer has this shape:

```json
{ "error": "A sentence for a log.", "code": "a_stable_code" }
```

| Status | Code | Meaning |
|---|---|---|
| 401 | `token_invalid` | No token, or no server holds it. Stop and tell the operator. |
| 403 | `server_disabled` | The server exists and an admin switched it off. |
| 403 | `not_allowed` | This server may not do that. The answer names the setting. |
| 404 | `not_found` | The thing named does not exist. |
| 409 | `superseded` | Another process said `hello` with this token after you. Stop calling. |
| 409 | `not_linked` | The player has no account on the site. |
| 409 | various | The request was understood and refused, see each endpoint. |
| 422 | `invalid_request` | The body does not match this page. |
| 426 | `protocol_unsupported` | `supported` lists the versions this site speaks. |
| 429 | `rate_limited` | Wait for `Retry-After` seconds. |
| 503 | `maintenance` | The site is in maintenance. Retry later. |

A client treats every other status, a timeout and a refused connection the same way: the site
is unreachable for now.

### Idempotency

Every call that moves credits or claims something carries `idempotencyKey`, a string of 8 to 80
characters the client makes once per user action and reuses on every retry of that action. The
site keeps the first answer for each server and key for 24 hours and returns it again, so a retry
after a timeout never charges twice.

## Starting

### `POST hello`

```json
{
  "instance": "6f1c...",
  "client": { "name": "blysis-connect-minecraft", "version": "1.0.0" },
  "game": "minecraft",
  "software": { "name": "Paper", "version": "26.2-112" },
  "role": "server"
}
```

`role` is `server` or `network-root`. A proxy is a network root.

```json
{
  "server": { "id": "clx...", "name": "Survival" },
  "site": { "name": "Example", "url": "https://example.com" },
  "settings": { "pollHoldSeconds": 25, "statusIntervalSeconds": 30, "leaseSeconds": 120, "catalogVersion": "c-1734" },
  "takeover": null
}
```

`takeover` is `null`, or `{ "previousInstance": "...", "lastSeen": "..." }` when another process
used this token in the last 90 seconds. After a restart that is the old process. Otherwise two
servers share one token, and the client says so in its console.

## Delivery

### Job

```json
{
  "id": "clx...",
  "groupKey": "order:clx...:server:clx...",
  "sequence": 0,
  "command": "lp user Notch parent addtemp vip 30d",
  "player": { "id": "069a79f4-...", "name": "Notch" },
  "whenOnline": true,
  "reference": { "kind": "order", "id": "clx...", "label": "VIP (30 days)" }
}
```

- `player.id` may be `null`: the site knows only the name typed at checkout, until it sees the
  player on a server and pins the id.
- `reference.kind` is `order`, `chest`, `gift` or `manual`.

States on the site: `PENDING`, `CLAIMED`, `DONE`, `FAILED`, `NEEDS_REVIEW`, `CANCELLED`.

### `POST poll`

```json
{ "instance": "6f1c...", "eventCursor": "e-1029" }
```

The site holds the request for up to `pollHoldSeconds` and answers as soon as it has jobs or
events for this server, or at the end with empty lists:

```json
{
  "jobs": [ { "...": "a Job" } ],
  "events": [ { "...": "an Event" } ],
  "eventCursor": "e-1031",
  "catalogVersion": "c-1734"
}
```

- Every returned job is already `CLAIMED` by this server, with a lease of `leaseSeconds`.
- While the request is held, a token revoked, a server switched off, or a process superseded ends
  it with `401`, `403` or `409` before anything else is claimed.
- A poll also returns jobs this server claimed at least 15 seconds earlier and has not reported,
  while their lease lasts. An answer lost on the way back is recovered that way. A client skips
  every job id its journal already holds, so a job it is running or has run is never run again.
- Jobs with the same `groupKey` come back together, ordered by `sequence`.
- A job is returned to a server when its target is that server, or when its target is the
  player's current server, the player is on that server, and an admin allowed that server to
  take such jobs (`acceptFollowPlayer`, off by default, because the server's own status push is
  the only evidence of who is on it). A `whenOnline` job is returned only
  while the player is online there. Online means present in that server's last status push, and
  seen within two status intervals.
- `eventCursor` starts at the value returned by the first `poll` without one: a client that has
  just started gets no backlog.
- A client opens the next poll as soon as one returns.

### What a client does with a job

1. If the journal already holds the job id, skip it: it was offered again. Otherwise write
   `started` for the job id to the journal.
2. If the player left since the claim and the job is `whenOnline`, report `deferred` and do not
   run it.
3. Strip one leading `/` and any `namespace:` from the first word. If that word is blocked, report
   `failed` with `blocked` as the detail and do not run it.
4. Run it on the console. Write the outcome to the journal.
5. Report. When the report is accepted, mark the journal entry acknowledged.

In a group, after one `failed`, report every later job of the group `failed` with the detail
`skipped`, without running it.

On start, a client reports every journal entry that has an outcome and no acknowledgement, and
reports `unknown` for every entry that has `started` and no outcome.

### `POST jobs/report`

```json
{
  "instance": "6f1c...",
  "results": [
    { "id": "clx...", "outcome": "done", "detail": null },
    { "id": "cly...", "outcome": "failed", "detail": "Unknown command" }
  ]
}
```

`outcome` is `done`, `failed`, `deferred` or `unknown`.

```json
{ "accepted": ["clx...", "cly..."] }
```

- `done` and `failed` settle the job. They are accepted for a job this server claimed, whether
  it is still `CLAIMED` or has fallen to `NEEDS_REVIEW`. Reporting the same outcome again is
  accepted and changes nothing.
- `deferred` returns a `CLAIMED` job to `PENDING`.
- `unknown` turns a `CLAIMED` job into `NEEDS_REVIEW`.
- A job whose lease runs out turns into `NEEDS_REVIEW`. The site never hands a
  `NEEDS_REVIEW` job out again on its own. An admin marks it done or sends it again.
- Results from any instance of the same server are accepted, so a restarted process can replay
  its journal. A result for a job of another server is left out of `accepted`.

## Status

### `POST status`

```json
{
  "instance": "6f1c...",
  "online": 12,
  "max": 100,
  "players": [ { "id": "069a79f4-...", "name": "Notch" } ],
  "version": "26.2",
  "performance": { "tps": 19.98, "mspt": 11.2 }
}
```

Answer `204`. A client sends it every `statusIntervalSeconds` and, at most once a second, after
a player joins or leaves. `performance` is optional.

## Catalogue

### `GET catalog`

`If-None-Match` with the last `version` answers `304`.

```json
{
  "version": "c-1734",
  "currency": "credits",
  "categories": [
    {
      "id": "clc...",
      "parentId": null,
      "title": "Ranks",
      "description": "Ranks for every server.",
      "icon": "diamond_chestplate",
      "order": 0,
      "products": [
        {
          "id": "clp...",
          "title": "VIP",
          "description": "Thirty days of VIP.",
          "icon": "golden_helmet",
          "price": 100,
          "giftable": true,
          "maxQuantity": 10,
          "stock": null,
          "servers": ["Survival", "Lobby"],
          "fields": [
            { "name": "colour", "label": "Name colour", "type": "select", "required": true,
              "placeholder": null, "options": ["red", "blue"] }
          ]
        }
      ]
    }
  ]
}
```

Only categories and products marked visible in game appear, and a product only when its
category is visible too. `icon` is free text each client reads its own way. `stock` is `null`
when unlimited. `type` is `text`, `number` or `select`.

## A player and their account

### `POST player/profile`

```json
{ "player": { "id": "...", "name": "Notch" } }
```

```json
{ "linked": true, "member": { "username": "notch", "balance": 250, "receiveGifts": true } }
```

`linked: false` comes without `member`.

### `POST link/start`

```json
{ "player": { "id": "...", "name": "Notch" } }
```

```json
{ "code": "K7Q2-M9XD", "url": "https://example.com/en/link?code=K7Q2-M9XD", "expiresAt": "..." }
```

The member opens the url signed in and confirms. The site then sends a `link.confirmed` event.
Refusals: `409 already_linked`.

### `POST link/verify`

```json
{ "player": { "id": "...", "name": "Notch" }, "code": "4J8P-2WQZ" }
```

The code was made on the site by a signed-in member. Answer `{ "linked": true, "member":
{ "username": "notch" } }`. Refusals: `409 code_invalid` (wrong, expired or used; five wrong
tries spend the code), `409 already_linked`.

Codes for both directions are single use and live for ten minutes.

## Credits

### `POST credits/transfer`

```json
{ "player": { "...": "..." }, "to": "SomePlayer", "amount": 50, "idempotencyKey": "..." }
```

`to` is a player name, which the site resolves through links, then a member's username. Answer
`{ "sent": 50, "to": "someplayer", "balance": 200 }`. Refusals: `409 not_linked`,
`409 recipient_unknown`, `409 insufficient_balance`, `409 amount_invalid`, `409 same_account`.

### `POST credits/admin`

Needs the server setting `allowCreditAdmin`.

```json
{ "actor": { "id": "...", "name": "Admin" }, "target": "SomePlayer", "operation": "add",
  "amount": 100, "idempotencyKey": "..." }
```

`operation` is `add`, `remove`, `set` or `show`. `show` needs no key. Answer
`{ "target": "someplayer", "balance": 300 }`. Refusals: `403 not_allowed`,
`409 recipient_unknown`, `409 amount_invalid`, `409 insufficient_balance` (a remove below zero).

### `GET credits/top?kind=balance&period=all&limit=10`

`kind` is `balance` or `topups`. `period` is `day`, `month`, `year` or `all` and applies to
`topups`. Answer `{ "entries": [ { "rank": 1, "name": "notch", "amount": 900 } ] }`. A member who
asked to be anonymous is `null` in `name`.

### `GET community-goal`

`{ "active": true, "title": "...", "raised": 420, "goal": 1000, "percent": 42 }`, or
`{ "active": false }`.

## Buying

### `POST store/purchase`

```json
{
  "player": { "...": "..." },
  "productId": "clp...",
  "quantity": 1,
  "fields": { "colour": "red" },
  "recipient": "AnotherPlayer",
  "idempotencyKey": "..."
}
```

`recipient` is optional and means a gift. Answer
`{ "orderId": "...", "orderNumber": "...", "total": 100, "balance": 150, "gift": false }`.
Refusals: `409 not_linked`, `409 not_found`, `409 not_in_game`, `409 insufficient_balance`,
`409 out_of_stock`, `409 quantity_invalid`, `409 field_invalid` (with `field`),
`409 recipient_unknown`, `409 not_giftable`, `409 recipient_refuses_gifts`.

A purchase for oneself goes to delivery at once. A gift lands in the recipient's chest as a
pending gift.

## Chest and gifts

### `POST chest/list`

```json
{ "player": { "...": "..." } }
```

```json
{
  "items": [
    { "id": "clh...", "productId": "clp...", "title": "VIP", "icon": "golden_helmet", "quantity": 1,
      "state": "ready", "from": null, "createdAt": "..." },
    { "id": "clg...", "productId": "clp...", "title": "VIP", "icon": "golden_helmet", "quantity": 1,
      "state": "pending_gift", "from": "someplayer", "createdAt": "..." }
  ],
  "receiveGifts": true
}
```

### `POST chest/claim`, `POST chest/activate`

```json
{ "player": { "...": "..." }, "itemId": "clh...", "idempotencyKey": "..." }
```

`claim` sends a `ready` item to delivery. `activate` turns a `pending_gift` into `ready`.
Answer `{ "ok": true }`. Refusals: `409 not_found`, `409 already_claimed`, `409 not_pending`.

### `POST gifts/sent`

`{ "player": {...} }` answers `{ "items": [ { "id", "title", "icon", "quantity", "to", "state",
"createdAt" } ] }`, `state` being `pending_gift` or `accepted`.

### `POST gifts/cancel`

`{ "player": {...}, "itemId": "...", "idempotencyKey": "..." }` answers
`{ "refunded": 100, "balance": 250 }`. Refusals: `409 not_pending` (already activated or
cancelled).

### `POST gifts/receive`

`{ "player": {...}, "receive": false }` answers `{ "receiveGifts": false }`.

## Vouchers

### `POST vouchers/create`

`{ "player": {...}, "amount": 50, "idempotencyKey": "..." }` takes 50 from the player and answers
`{ "voucherId": "gv_...", "amount": 50, "balance": 200 }`.

### `POST vouchers/give`

Needs the server setting `allowVoucherGive`. `{ "actor": {...}, "amount": 50, "idempotencyKey":
"..." }` mints a voucher nobody paid for and answers `{ "voucherId": "gv_...", "amount": 50 }`.

### `POST vouchers/redeem`

`{ "player": {...}, "voucherId": "gv_..." }` answers `{ "amount": 50, "balance": 250 }`.
Refusals: `409 voucher_used` (with `usedAt`), `409 not_found`, `409 not_linked`.

The id is the whole voucher. An item that carries it is only its look.

## Events

```json
{ "id": "e-1031", "type": "purchase", "at": "...", "data": { "player": "notch", "product": "VIP", "quantity": 1 } }
```

| Type | Data |
|---|---|
| `purchase` | `player` (null when anonymous), `product`, `quantity` |
| `topup` | `player` (null when anonymous), `amount` |
| `goal.reached` | `title`, `goal` |
| `link.confirmed` | `player` (a Player), `member` |
| `catalog.changed` | `version` |

An event is sent to every server, except `link.confirmed`, which goes to the server the player
was on when the code was made. Events are kept for a day.

## Versioning

The protocol version is a whole number. A site lists every version it speaks in `426`. A new
optional field or a new event type does not change the version, so a client ignores fields and
event types it does not know.
