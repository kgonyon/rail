.PHONY: install publish test typecheck check-bun deps

install: check-bun deps
	bun run install:local

uninstall: 
	bun run uninstall:local

publish: check-bun deps typecheck test
	@sh .ci/publish.sh

test: check-bun deps
	bun test

typecheck: check-bun deps
	bun run typecheck

check-bun:
	@command -v bun >/dev/null 2>&1 || { \
		echo "Error: bun is not installed. Install it from https://bun.sh"; \
		exit 1; \
	}

deps:
	@if [ ! -d node_modules ] || [ bun.lock -nt node_modules ] || [ package.json -nt node_modules ]; then \
		bun install; \
	fi
