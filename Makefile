.PHONY: install check-bun deps

install: check-bun deps
	bun run install:local

check-bun:
	@command -v bun >/dev/null 2>&1 || { \
		echo "Error: bun is not installed. Install it from https://bun.sh"; \
		exit 1; \
	}

deps:
	@if [ ! -d node_modules ] || [ bun.lock -nt node_modules ] || [ package.json -nt node_modules ]; then \
		bun install; \
	fi
