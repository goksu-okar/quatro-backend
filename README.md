# Quatro backend

Order management API for a surf company: customers, board orders, order statuses and login.
Express + Mongoose on MongoDB Atlas. The frontend lives in `quatro-demo`.

## Repos

The code lives in forks under the `goksu-okar` GitHub account:

- Backend: https://github.com/goksu-okar/quatro-backend
- Frontend: https://github.com/goksu-okar/quatro-demo

They were forked from `GoksuOkar/...`, an account we no longer have access to. Always push to and open pull requests against the `goksu-okar` forks. GitHub tools (including `gh pr create`) default to the original repo for a fork, so pass `--repo goksu-okar/<repo>`.

## Running locally

```bash
npm install
npm start        # nodemon, http://localhost:3000
npm test         # node:test + supertest against an in-memory MongoDB
```

`.env` (not committed):

| Name | What it is |
| --- | --- |
| `MONGOUSER`, `MONGOPSSWD` | Atlas database user |
| `MONGODB_NAME` | `quatro-dev` locally; `quatro` (or unset) is production |
| `JWT_SECRET` | Long random string that signs login tokens. Make one with `openssl rand -hex 32`. Use a different one on every machine. |
| `PORT` | Optional, defaults to 3000 |

Keep `MONGODB_NAME=quatro-dev` locally. Without it the app uses the production database, and anything you do while testing changes real orders.

### Atlas blocks the connection

If the backend crashes with a TLS "alert number 80" or "Could not connect to any servers", your public IP isn't on the Atlas access list. This happens whenever your network changes (e.g. a phone hotspot).

1. Find your IP: `curl https://api.ipify.org`
2. Add it in Atlas under **Network Access**, and wait about a minute.
3. Type `rs` in the backend terminal (or save any file). nodemon doesn't retry by itself after a crash.

## Login

There is one shop login. Its email and password hash live in the `AuthConfig` collection of each database, so each database needs it set once:

```bash
node scripts/seed-auth.js                       # the database in MONGODB_NAME
MONGODB_NAME=quatro node scripts/seed-auth.js   # production
```

The script prompts for the email and password. Run it again to reset a forgotten password.

Tokens last 7 days. Changing `JWT_SECRET` logs everyone out, and they just log in again.

## Orders: things to know

- **Statuses** are fixed in `db/index.js` (`ORDER_STATUSES`) and served at `GET /order-statuses`, in workflow order: ordered → milled → bottom sandwich → sandwiched → bogged → hot coated → sanded → airbrushed → completed.
  - Any status can move to any other.
  - Orders from before statuses existed have no status, on purpose. Don't add a schema default (Mongoose applies it on read) or a backfill.
  - "Active" means every status except completed.
- **Due dates** are stored in `dueOn` as a plain date, `"YYYY-MM-DD"`. The form defaults new orders to 8 weeks out. Older orders have free-text `dueDate` instead; it's kept as-is, shown dimmed, and sorts last.

## Deploying

The backend runs on an AWS EC2 server (us-west-2) behind `frwdmauiapi.com`, managed by **pm2**.

Deploy the backend first, then the frontend straight after. The site doesn't work in between if one side expects a login and the other doesn't.

On the server:

```bash
node -v                             # must be 20.19 or newer (Mongoose 9)
cd ~/quatro-backend                 # wherever the app lives
git remote -v                       # must be goksu-okar/quatro-backend; if not:
git remote set-url origin https://github.com/goksu-okar/quatro-backend.git
git pull
npm install --omit=dev              # skip test tools (they download a whole MongoDB)
pm2 restart all                     # or the app name from `pm2 list`
curl -i localhost:3000/order-statuses   # expect 401: the API requires a login
```

The server has its own `.env`. It needs its own `JWT_SECRET` (generate it on the server, never copy a local one) and `MONGODB_NAME` unset or `quatro`. Run `pm2 restart` after changing it.

The frontend deploys on Vercel; see the frontend README.

## Backups

In MongoDB Compass, open each collection (`orders`, `customers`) and use **Export Collection** to JSON.
