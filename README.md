# Atlesque Accounts

One account for every MBP game: players sign in once with their email and their progress in each game is saved to it. A Cloudflare Worker with a D1 database, at **https://accounts.atlesque.dev**.

The first game on it is [MBP - Scrum City](https://github.com/atlesque/mbp-scrum-city).

## What players see

- **`/signin`**: the hosted sign-in every game sends players to. They type their email and get a link; opening it (on any device) and pressing **Sign in** confirms the address, creates the account the first time, and signs them in. The tab that asked carries on by itself and goes back to the game. Already signed in on this site? It's one click ("Continue as …"), which is the single sign-on part.
- **`/`**: the account hub: who you're signed in as and the games you've played.
- **`/admin`**: for the emails in `ADMIN_EMAILS`: every player with their games and progress, and buttons to reset a game's progress, ban or unban, and sign a player out everywhere. Every admin action is logged on the player's page. A second tab lists **pending registrations**: addresses that asked for a sign-in link in the last 90 days but never opened one, with whether each verification email was sent or failed (and why).

There are no passwords. A link works once and runs out after 15 minutes; an email can ask for 5 links per 15 minutes and an IP for 20 per hour.

## Adding a game

1. Add it to `GAMES` in `src/clients.js`: an id, its name and URL, the `origins` its pages are served from (they're allowed to send players to `/signin`, get them back, and call the API), and a `summary(save)` for the admin page.
2. In the game, send players to sign in and sync their save. `public/js/core/account.js` in the Scrum City repo is a complete client to copy.

### The flow, for a game

1. Make a random `code_verifier` and its `code_challenge` = base64url(SHA-256(verifier)), plus a random `state`; keep them in `localStorage`.
2. Send the player to `https://accounts.atlesque.dev/signin?client=<game id>&redirect_uri=<this page>&state=<state>&code_challenge=<challenge>`.
3. They come back to `redirect_uri` with `?mbpg_code=…&mbpg_state=…`. Check the state, then `POST /api/token` with `{ code, code_verifier, client, redirect_uri }` to get `{ token, user: { id, email }, expiresAt }`. Tokens last 90 days.
4. Send the token as `Authorization: Bearer <token>`:
   - `GET /api/me` → `{ user }`
   - `GET /api/games/<game>/progress` → `{ data, rev, updatedAt }` (`data` is `null` before the first save, or after an admin reset)
   - `PUT /api/games/<game>/progress` with `{ data, rev }`, where `rev` is the one you last read or wrote (0 for none). Answers `{ rev }`, or **409** with the account's current `{ data, rev }` when it moved on without you (another device, an admin reset): adopt that copy. Saves are JSON objects up to 64 KB.
   - `POST /api/logout` ends the token.
   - **401** means the token is gone (signed out everywhere); **403** with `error: "banned"` means the account is banned and `message` says why.

## Multiplayer

One shared room per game, at **`wss://accounts.atlesque.dev/mp/<game>`**: a Durable Object (`src/room.js`) that takes up to 16 players and relays what each sends to the others. Each client remains the authority on its own player. World incidents are server-owned and persisted across hibernation; a Durable Object alarm wakes at independent start/end deadlines. The alarm and incident state are removed when the last player leaves. Only a game's own `origins` can join.

- First message: `{ t: 'hello', name }` (cut to 16 characters). The answer is `{ t: 'welcome', id, max, players: [{ id, name }] }`; the others get `{ t: 'join', id, name }`, and `{ t: 'leave', id }` when someone goes.
- World events: the server broadcasts `events {now, active}` snapshots on joins, incident transitions and accepted actions. Incidents carry a unique key, seed, anchor, start/end time, boss HP, selected UFO victim/capture and collected cash indices. `evhit`, `evgrab` and `evcash` request damage, capture or a landed cash collection. Capture and collection use the player's last reported state; collections allow vehicles and require contact within 1.2 metres. `evaward` confirms a unique $25 payout. These server message types cannot be forged through the relay. The event catalog and deterministic random helper must match Scrum City's copies.
- Any other message (a type of 1-8 lowercase letters) goes to everyone else with the sender's `id` added, or, with a `to`, to that one player only, with `from`. The relay doesn't need to know other game types (Scrum City's are in its `public/js/net/protocol.js`), so a game can add one without a deploy here. The room's own types, anything else, or over 2 KB, is dropped.
- A 17th player gets `{ t: 'full' }` and close code 4001. The text `ping` is answered `pong` without waking the room.

What it costs while people play (Workers Paid; the Free plan has 100,000 requests a day): incoming messages bill at 20 per request. Scrum City sends 10 states a second while a player moves and 1 while they stand still, so a full room of 16 moving players is about 8 requests a second (about 29,000 an hour, $0.15 per million past the included million a month). Duration is billed only while a message is being handled.

## Running it

```sh
npm install
npm run dev      # local database + http://localhost:8787; emails aren't sent, they're saved under .wrangler/tmp/email
npm test         # the Worker end to end on Node's built-in SQLite (test/d1.js stands in for D1)
npm run deploy   # applies new migrations to the real database, then deploys
```

Point a local copy of the game at it with `?debug&accounts=http://localhost:8787`. In the Scrum City repo, `node tests/account-shots.mjs <folder>` (with this repo checked out next to it) plays the whole flow in a browser (guest, sign-in, sync on death, admin reset and ban) and saves screenshots.

## Cloudflare setup

- **D1 database** `mbp-games` (id in `wrangler.jsonc`). Schema changes are new files in `migrations/`.
- **Email**: Cloudflare Email Service, with `atlesque.dev` onboarded for sending (Compute → Email Service → Email Sending). Mail comes from `noreply@atlesque.dev`; the binding is restricted to that sender.
- **Secret** `ADMIN_EMAILS`: comma-separated emails that can open `/admin`. Set it in the Worker's settings (or `wrangler secret put ADMIN_EMAILS`).
- **Domain**: `accounts.atlesque.dev`, a custom domain on the Worker (from `routes` in `wrangler.jsonc`).
- A cron at 03:17 UTC clears out expired links, codes and sign-ins.
- **Durable Object** `GameRoom` (binding `ROOMS`) for multiplayer, created by the `v1` migration in `wrangler.jsonc` on the first deploy that has it. No dashboard setup.
