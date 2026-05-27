# Piano Tutor Research

Сервис для умной практики фортепиано

## Что внутри

- **Frontend**: Next.js App Router, TypeScript, Tailwind, Recharts.
- **Backend**: FastAPI, SQLite, локальный JWT/RBAC.
- **ML/Data Pipeline**: audio preprocessing, AMT teacher, assistant corrector, postprocessing, alignment, scoring.
- **Research Lab**: synthetic mini-benchmark, ablation runner, research runs, Markdown/JSON export.
- **Роли**: `student`, `teacher`, `researcher`, `admin`.

## Локальный запуск без Docker

```bash
make dev
```

Команда автоматически подготовит зависимости для backend/frontend и запустит оба сервиса:

- Frontend: http://localhost:3000
- Backend healthcheck: http://localhost:8000/health

Если нужен audio AMT с загрузкой checkpoint:

```bash
make dev ALLOW_MODEL_DOWNLOAD=true
```

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
ALLOW_MODEL_DOWNLOAD=false uvicorn app.main:app --reload --port 8000
```

Если нужен audio AMT, разрешите скачивание checkpoint или заранее положите модель в cache:

```bash
ALLOW_MODEL_DOWNLOAD=true uvicorn app.main:app --reload --port 8000
```

Полезные env:

- `DATABASE_URL=sqlite:///./data/app.db`
- `JWT_SECRET=change-me`
- `CORS_ORIGINS=http://localhost:3000`
- `CORRECTOR_CKPT=data/corrector_ckpt.pt`
- `ALLOW_MODEL_DOWNLOAD=false`

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Откройте http://localhost:3000

Production check:

```bash
cd frontend
npm run build
```

## Docker

```bash
docker compose up --build
```
