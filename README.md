# Lecture Intelligence

Full-stack app for turning YouTube lectures into structured study material — outline, summaries, flashcards, and semantic search.

## Stack

- **Backend:** FastAPI (Python)
- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Planned:** LangGraph orchestration, Google Gemini, Google gemini-embedding-001, ChromaDB

## Repo layout

```
.
├── backend/        FastAPI app
├── frontend/       Next.js 14 + Tailwind
├── .gitignore      Combined Python + Node ignores
└── README.md       this file
```

## Prerequisites

- Python 3.11+
- Node.js 20+
- A Google Gemini API key

## Backend setup

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # then edit .env and set GEMINI_API_KEY
uvicorn main:app --reload
```

API runs at `http://localhost:8000`. Health check: `GET /health`.

## Frontend setup

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

App runs at `http://localhost:3000`.

## Configuration

Secrets are loaded from `.env` files — never hardcoded in source.

| Variable                     | File                  | Purpose                                |
| ---------------------------- | --------------------- | -------------------------------------- |
| `GEMINI_API_KEY`             | `backend/.env`        | Google Gemini API key (required)       |
| `NEXT_PUBLIC_API_BASE_URL`   | `frontend/.env.local` | Backend base URL (e.g. `http://localhost:8000`) |
