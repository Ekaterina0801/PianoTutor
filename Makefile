.PHONY: dev stop check-ports setup backend-dev frontend-dev backend-setup frontend-setup backend-test frontend-build check help

PYTHON ?= python3
BACKEND_PORT ?= 8000
FRONTEND_PORT ?= 3000
NEXT_PUBLIC_API_BASE ?= http://localhost:$(BACKEND_PORT)
ALLOW_MODEL_DOWNLOAD ?= false
MODEL_CACHE_DIR ?= $(CURDIR)/backend/data/model_cache
PIP_CACHE_DIR ?= /tmp/piano_tutor_pip_cache
NPM_CONFIG_CACHE ?= /tmp/piano_tutor_npm_cache
DATABASE_URL ?= sqlite:///./data/app.db
JWT_SECRET ?= change-me
CORS_ORIGINS ?= http://localhost:$(FRONTEND_PORT)
TCN_CORRECTOR_CKPT ?= data/maestro_research/checkpoints/tcn_maestro.pt
BILSTM_CORRECTOR_CKPT ?= data/maestro_research/checkpoints/bilstm_maestro.pt
TRANSFORMER_CORRECTOR_CKPT ?= data/maestro_research/checkpoints/transformer_maestro.pt
CORRECTOR_CKPT ?= $(TCN_CORRECTOR_CKPT)
TCN_ONSET_THR ?= 0.45
TCN_FRAME_THR ?= 0.45
BILSTM_ONSET_THR ?= 0.45
BILSTM_FRAME_THR ?= 0.40
TRANSFORMER_ONSET_THR ?= 0.45
TRANSFORMER_FRAME_THR ?= 0.40

BACKEND_VENV := backend/.venv
BACKEND_STAMP := $(BACKEND_VENV)/.requirements.stamp
FRONTEND_STAMP := frontend/node_modules/.package-lock.stamp

help:
	@echo "Available targets:"
	@echo "  make dev             Setup and run backend + frontend locally"
	@echo "  make stop            Stop local backend/frontend instances"
	@echo "  make setup           Install backend and frontend dependencies"
	@echo "  make backend-dev     Run FastAPI on port $(BACKEND_PORT)"
	@echo "  make frontend-dev    Run Next.js on port $(FRONTEND_PORT)"
	@echo "  make backend-test    Run backend pytest suite"
	@echo "  make frontend-build  Build frontend production bundle"
	@echo "  make check           Run backend tests + frontend build"

dev:
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory setup
	@$(MAKE) --no-print-directory check-ports
	@echo "Starting local dev servers..."
	@echo "Frontend: http://localhost:$(FRONTEND_PORT)"
	@echo "Backend:  http://localhost:$(BACKEND_PORT)/health"
	@trap 'trap - INT TERM EXIT; kill $$backend_pid $$frontend_pid 2>/dev/null; wait $$backend_pid $$frontend_pid 2>/dev/null' INT TERM EXIT; \
	$(MAKE) --no-print-directory backend-dev & backend_pid=$$!; \
	$(MAKE) --no-print-directory frontend-dev & frontend_pid=$$!; \
	while kill -0 $$backend_pid 2>/dev/null && kill -0 $$frontend_pid 2>/dev/null; do sleep 1; done; \
	trap - INT TERM EXIT; \
	kill $$backend_pid $$frontend_pid 2>/dev/null; \
	wait $$backend_pid $$frontend_pid

stop:
	@echo "Stopping local app instances on ports $(BACKEND_PORT) and $(FRONTEND_PORT)..."
	@if command -v docker >/dev/null 2>&1; then \
		docker compose down 2>/dev/null || true; \
	fi
	@for port in $(BACKEND_PORT) $(FRONTEND_PORT); do \
		pids=$$(lsof -ti tcp:$$port -sTCP:LISTEN 2>/dev/null || true); \
		if [ -n "$$pids" ]; then \
			echo "Stopping process(es) on port $$port: $$pids"; \
			kill $$pids 2>/dev/null || true; \
		else \
			echo "No process found on port $$port"; \
		fi; \
	done
	@sleep 1
	@for port in $(BACKEND_PORT) $(FRONTEND_PORT); do \
		pids=$$(lsof -ti tcp:$$port -sTCP:LISTEN 2>/dev/null || true); \
		if [ -n "$$pids" ]; then \
			echo "Force stopping process(es) on port $$port: $$pids"; \
			kill -9 $$pids 2>/dev/null || true; \
		fi; \
	done

check-ports:
	@busy=0; \
	for port in $(BACKEND_PORT) $(FRONTEND_PORT); do \
		pids=$$(lsof -ti tcp:$$port -sTCP:LISTEN 2>/dev/null || true); \
		if [ -n "$$pids" ]; then \
			echo "Port $$port is still busy: $$pids"; \
			busy=1; \
		fi; \
	done; \
	if [ "$$busy" -ne 0 ]; then \
		echo "Run 'make stop' or choose another port, e.g. make dev FRONTEND_PORT=3001"; \
		exit 1; \
	fi

setup: backend-setup frontend-setup

backend-setup: $(BACKEND_STAMP)

$(BACKEND_STAMP): backend/requirements.txt
	@if [ ! -x "$(BACKEND_VENV)/bin/python" ]; then \
		echo "Creating backend virtualenv with $(PYTHON)..."; \
		$(PYTHON) -m venv "$(BACKEND_VENV)"; \
	fi
	@echo "Installing backend dependencies..."
	@PIP_CACHE_DIR="$(PIP_CACHE_DIR)" PIP_DISABLE_PIP_VERSION_CHECK=1 $(BACKEND_VENV)/bin/python -m pip install --upgrade pip
	@PIP_CACHE_DIR="$(PIP_CACHE_DIR)" PIP_DISABLE_PIP_VERSION_CHECK=1 $(BACKEND_VENV)/bin/pip install -r backend/requirements.txt
	@touch "$(BACKEND_STAMP)"

frontend-setup: $(FRONTEND_STAMP)

$(FRONTEND_STAMP): frontend/package.json frontend/package-lock.json
	@echo "Installing frontend dependencies..."
	@cd frontend && NPM_CONFIG_CACHE="$(NPM_CONFIG_CACHE)" npm ci
	@touch "$(FRONTEND_STAMP)"

backend-dev: backend-setup
	@cd backend && \
	DATABASE_URL="$(DATABASE_URL)" \
	JWT_SECRET="$(JWT_SECRET)" \
	CORS_ORIGINS="$(CORS_ORIGINS)" \
	ALLOW_MODEL_DOWNLOAD="$(ALLOW_MODEL_DOWNLOAD)" \
	MODEL_CACHE_DIR="$(MODEL_CACHE_DIR)" \
	CORRECTOR_CKPT="$(CORRECTOR_CKPT)" \
	TCN_CORRECTOR_CKPT="$(TCN_CORRECTOR_CKPT)" \
	BILSTM_CORRECTOR_CKPT="$(BILSTM_CORRECTOR_CKPT)" \
	TRANSFORMER_CORRECTOR_CKPT="$(TRANSFORMER_CORRECTOR_CKPT)" \
	TCN_ONSET_THR="$(TCN_ONSET_THR)" \
	TCN_FRAME_THR="$(TCN_FRAME_THR)" \
	BILSTM_ONSET_THR="$(BILSTM_ONSET_THR)" \
	BILSTM_FRAME_THR="$(BILSTM_FRAME_THR)" \
	TRANSFORMER_ONSET_THR="$(TRANSFORMER_ONSET_THR)" \
	TRANSFORMER_FRAME_THR="$(TRANSFORMER_FRAME_THR)" \
	./.venv/bin/uvicorn app.main:app --reload --port "$(BACKEND_PORT)"

frontend-dev: frontend-setup
	@cd frontend && \
	NEXT_PUBLIC_API_BASE="$(NEXT_PUBLIC_API_BASE)" \
	./node_modules/.bin/next dev -p "$(FRONTEND_PORT)"

backend-test: backend-setup
	@cd backend && ./.venv/bin/python -m pytest

frontend-build: frontend-setup
	@cd frontend && NEXT_PUBLIC_API_BASE="$(NEXT_PUBLIC_API_BASE)" npm run build

check: backend-test frontend-build
