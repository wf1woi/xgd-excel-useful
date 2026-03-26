# Repository Guidelines

## Project Structure & Module Organization
This repository is split into `backend/`, `frontend/`, and `docs/`. The backend is a FastAPI service: `backend/app/api` holds routes, `backend/app/services` contains business flows, `backend/app/engines` handles Excel and rule execution, and `backend/app/models`, `schemas`, and `repositories` define persistence layers. SQLite schema and runtime data live under `backend/db/` and `backend/storage/`. The frontend is a React + TypeScript + Vite app in `frontend/src/`, with API clients under `src/api`, shared types in `src/types`, and the main UI currently centered in `src/App.tsx`. Sample Excel assets and product notes are in `docs/`.

## Build, Test, and Development Commands
Backend commands run from `backend/`:

- `uv sync`: install Python dependencies into the local virtual environment.
- `uv run main.py`: start the FastAPI server on `127.0.0.1:8000`.

Frontend commands run from `frontend/`:

- `npm install`: install Node dependencies.
- `npm run dev`: start the Vite dev server on `http://localhost:5173`.
- `npm run build`: run TypeScript build checks and create a production bundle.
- `npm run lint`: run ESLint across the frontend source.

For local setup on macOS or Windows, use the root scripts `start_mac.command`, `start_windows.bat`, or `start_windows.ps1`.

## Coding Style & Naming Conventions
Follow the style already in the repo: Python uses 4-space indentation, snake_case modules, and typed function signatures where practical. TypeScript and React files use 2-space indentation, single quotes, and PascalCase for components and types. Keep API helpers in `src/api/*.ts`, and match backend domains across `models`, `schemas`, `repositories`, and `services`. No formatter is configured, so keep changes consistent with nearby code and run `npm run lint` before submitting frontend work.

## Testing Guidelines
There is no committed automated test suite yet. Until one is added, verify changes with `npm run build`, `npm run lint`, and targeted manual checks against `uv run main.py` using the sample files in `docs/` such as `docs/模板规则.xlsx`. If you add tests, place backend tests under `backend/tests/` and frontend tests beside the feature as `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits, for example `feat(安装脚本): ...` and `fix(启动脚本): ...`. Keep that format: `type(scope): summary`, with concise Chinese scopes and summaries when appropriate. PRs should describe the user-facing change, list affected areas (`backend`, `frontend`, scripts, docs), note any manual verification performed, and include screenshots for UI changes.
