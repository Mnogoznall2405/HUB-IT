# IT-invent Web

Web application for IT equipment inventory management.

## Stack

- **Backend**: Python + FastAPI + pyodbc (SQL Server)
- **Internal App Data**: PostgreSQL (optional unified runtime for users/sessions/chat/settings)
- **Frontend**: React 18 + Vite + Material UI v5
- **Auth**: JWT tokens

## Project Structure

```
it-invent-web/
├── backend/              # FastAPI backend
│   ├── main.py         # Application entry point
│   ├── config.py        # Configuration
│   ├── database/        # SQL queries and connection
│   ├── models/          # Pydantic models
│   ├── api/v1/         # API endpoints
│   └── utils/          # Security, helpers
└── frontend/           # React frontend
    └── src/
        ├── api/          # API client
        ├── components/    # React components
        ├── contexts/      # Auth context
        └── pages/         # Page components
```

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- SQL Server with ITINVENT database
- PostgreSQL 14+ for internal app-owned data migration (optional but recommended)

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install fastapi uvicorn[standard] pyodbc python-jose[cryptography] passlib[bcrypt] pydantic[email] python-dotenv

# Configure single env in project root
cd ..
cp .env.example .env
# Edit .env with your database credentials, then return:
cd WEB-itinvent/backend

# Run development server
python -m uvicorn main:app --reload --port 8000
```

Backend will be available at:
- http://localhost:8000
- API docs: http://localhost:8000/docs

### Internal PostgreSQL Migration

To enable unified internal storage for users/sessions/settings/chat, configure `APP_DATABASE_URL` in the root `.env`.

To migrate current identity/settings data from the internal SQLite store:

```bash
python scripts/migrate_identity_sqlite_to_postgres.py --database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To apply schema migrations for the internal PostgreSQL database:

```bash
cd backend
alembic -c alembic.ini upgrade head
```

To migrate built-in chat data from a legacy SQLite database into PostgreSQL:

```bash
python scripts/migrate_chat_sqlite_to_postgres.py --source-db-path data/chat.sqlite3 --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate hub data from the internal SQLite database into PostgreSQL:

```bash
python scripts/migrate_hub_sqlite_to_postgres.py --source-db-path data/local_store.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate network data from the internal SQLite database into PostgreSQL:

```bash
python scripts/migrate_network_sqlite_to_postgres.py --source-db-path data/local_store.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate transfer act reminders from the internal SQLite database into PostgreSQL:

```bash
python scripts/migrate_reminders_sqlite_to_postgres.py --source-db-path data/local_store.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate env settings audit history from the legacy SQLite audit file into PostgreSQL:

```bash
python scripts/migrate_env_audit_sqlite_to_postgres.py --source-db-path data/env_settings_audit.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate mail metadata from the internal SQLite database into PostgreSQL:

```bash
python scripts/migrate_mail_sqlite_to_postgres.py --source-db-path data/local_store.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate MFU runtime/page snapshot state from the internal SQLite database into PostgreSQL:

```bash
python scripts/migrate_mfu_sqlite_to_postgres.py --source-db-path data/local_store.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate VCS computers/config/info from the internal SQLite database into PostgreSQL:

```bash
python scripts/migrate_vcs_sqlite_to_postgres.py --source-db-path data/local_store.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate AD user branch override mappings from the internal SQLite database into PostgreSQL:

```bash
python scripts/migrate_ad_branch_overrides_sqlite_to_postgres.py --source-db-path data/local_store.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate inventory snapshot/change history from the internal SQLite database into PostgreSQL:

```bash
python scripts/migrate_inventory_sqlite_to_postgres.py --source-db-path data/local_store.unified.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

To migrate `/api/v1/json/*` runtime datasets from the internal SQLite database into PostgreSQL:

```bash
python scripts/migrate_json_store_sqlite_to_postgres.py --source-db-path data/local_store.unified.db --target-database-url postgresql+psycopg://user:pass@host:5432/itinvent
```

For a full `WEB-itinvent` SQLite runtime cutover, keep `Scan Center` out of scope and configure `APP_DATABASE_URL` in the root `.env`. Chat may continue using `CHAT_DATABASE_URL`; it is already PostgreSQL-backed and does not block removal of SQLite from `WEB-itinvent` runtime.

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Frontend now reads VITE_* variables from project root .env
# (C:\Project\Image_scan\.env)

# Run development server
npm run dev
```

Frontend will be available at:
- http://localhost:5173

## Default Users

| Username | Password | Role |
|----------|----------|------|
| admin    | admin    | Admin |
| user     | user123  | User  |

**Important**: Change default passwords in production!

## Features

- [x] Authentication (JWT)
- [x] Equipment search by serial number
- [x] Employee search
- [ ] Equipment transfer
- [ ] Work tracking (cartridges, batteries, cleaning)
- [ ] Full database view with pagination
- [ ] Export to Excel
- [ ] Database switching

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` - Login
- `GET /api/v1/auth/me` - Get current user
- `POST /api/v1/auth/logout` - Logout

### Equipment
- `GET /api/v1/equipment/search/serial?q={query}` - Search by serial
- `GET /api/v1/equipment/search/employee?q={query}&page={page}` - Search by employee
- `GET /api/v1/equipment/{inv_no}` - Get by inventory number
- `GET /api/v1/equipment/database?page={page}` - Get all equipment
- `GET /api/v1/equipment/branches` - Get branches
- `GET /api/v1/equipment/locations/{branch_id}` - Get locations

## License

MIT
