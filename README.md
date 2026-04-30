# Store Manager

A unified web application for managing WooCommerce sites and running product upload, audit, and fix jobs against them. Replaces the separate `storeconfig` and `product-uploader` services.

## Tech Stack

- **Web:** Next.js 15 + TypeScript + Tailwind CSS
- **Database:** PostgreSQL via Prisma ORM
- **Worker:** Python 3 (`upload.py`) — spawned as a subprocess per job
- **Deployment:** Docker + docker-compose

---

## Local Development

### Prerequisites

- Node.js 20+
- Python 3.11+
- A running PostgreSQL instance (shared with the existing `storeconfig` DB)

### 1. Install dependencies

```bash
npm install
pip install -r worker/requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/config`) |
| `ORDERBOARD_API_URL` | Orderboard base URL (default: `https://orderboard.mlswebstores.com`) |
| `ORDERBOARD_EMAIL` | Orderboard login email |
| `ORDERBOARD_PASSWORD` | Orderboard login password |
| `STORE_MANAGER_URL` | URL this server is reachable at by the Python worker (default: `http://localhost:3000`) |
| `JOBS_DIR` | Directory for per-job logs and reports (default: `/data/jobs`) |

### 3. Run database migration

This adds the `Job` table. The existing `MLS_Webstore` and `OrderDesk` tables are left untouched.

```bash
npx prisma migrate dev
```

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app redirects to `/jobs` by default.

---

## Pages

### /jobs — Job Management

Submit and monitor upload, audit, and fix jobs:

- Select a **site** (loaded from the database) and an **orderboard store**
- Choose a **mode:** Upload, Audit, or Fix
- **Upload** mode has an optional *Force delete & re-create* checkbox
- **Fix** mode can be seeded from a previous audit job's report
- The jobs table auto-refreshes every 3 seconds
- Click a row to view the live log and report
- Completed audit jobs with issues show a **Fix Issues** button that starts a targeted fix job
- Use the **↻** (replay) button to re-run a finished job with the same parameters
- Use the **✕** button to remove a finished job, or **Cancel** to stop a running one
- Download the raw log or report with the **Log ↓** / **Report ↓** buttons

### /sites — Site Management

Full CRUD for WooCommerce site credentials:

- Search by name, slug, or SKU
- Sort by any column
- Paginate (10 / 20 / 50 / 100 per page)
- **Copy** an existing site as a starting point for a new one
- Edit or delete any site

---

## Deployment

### Build a distributable zip

```bash
make dist
```

Creates `dist/store-manager-YYYYMMDD.zip`. Override the date with `make dist VERSION=1.2.3`.

### Deploy to the remote server

```bash
./deploy.sh
```

This will:
1. Build the zip if one doesn't exist yet
2. Upload it to `david@192.168.0.9:/home/david/docker-images/store-manager/`
3. SSH in, unzip, and run `docker compose up -d --build`

### Docker environment variables

Set these in `docker-compose.yml` before deploying:

```yaml
environment:
  - DATABASE_URL=postgresql://user:pass@host.docker.internal:5432/config
  - ORDERBOARD_API_URL=https://orderboard.mlswebstores.com
  - ORDERBOARD_EMAIL=your@email.com
  - ORDERBOARD_PASSWORD=yourpassword
  - STORE_MANAGER_URL=http://localhost:3000
  - JOBS_DIR=/data/jobs
```

Job logs and reports are persisted in the `store_manager_data` Docker volume mounted at `/data`.

---

## Migration from Previous Services

### storeconfig

The `storeconfig` service (FastAPI + React + PostgreSQL) is replaced by this app. Its `MLS_Webstore` and `OrderDesk` tables are reused directly — no data migration needed, just point `DATABASE_URL` at the same PostgreSQL instance.

Once Store Manager is running and verified, the `storeconfig` Docker container can be decommissioned.

### product-uploader

The `product-uploader` service (FastAPI + vanilla JS + SQLite) is replaced by this app. The Python worker (`upload.py`) is copied into `worker/` unchanged.

The only config change: replace `DATABASE_SERVER_URL` with `STORE_MANAGER_URL` in any environment that runs the worker directly. The worker now calls `/api/sites` and `/api/orderdesk` on this server instead of the old storeconfig endpoints.

---

## Future: WooCommerce Product Querying

Add a new API route at `src/app/api/woocommerce/[siteId]/products/route.ts` that:
1. Looks up site credentials from Prisma
2. Calls the WooCommerce REST API with pagination
3. Returns the product list with variations

No structural changes to the app are needed.
