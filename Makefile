DIST       := dist
OUTPUT     := $(DIST)/netflix-subtitle-translator.user.js
SRC        := $(shell find src -name '*.js')
NODE_BIN   := node_modules/.bin

.PHONY: all build dev clean install lint check validate test coverage size smoke smoke-3b smoke-7b smoke-all headless headless-all headless-evaluate headless-analyze headless-replay headless-history headless-viewer simulate-normalization help

all: install build validate  ## Full pipeline: install, build, validate

# ── Build ────────────────────────────────────────────────────

build: $(OUTPUT)  ## Build the .user.js bundle

$(OUTPUT): $(SRC) vite.config.js package.json | node_modules
	npx vite build
	@xdg-open "$(CURDIR)/$(OUTPUT)" &

dev: | node_modules  ## Start Vite dev server with HMR
	npx vite

clean:  ## Remove build artifacts
	rm -rf $(DIST)

# ── Dependencies ─────────────────────────────────────────────

install: node_modules  ## Install npm dependencies

node_modules: package.json
	npm install
	@touch node_modules

# ── Validation ───────────────────────────────────────────────

test: | node_modules  ## Run unit tests
	npx vitest run

coverage: | node_modules  ## Run tests with coverage report
	npx vitest run --coverage

check: lint validate  ## Run all checks (lint + validate)

lint: | node_modules  ## Lint source files with ESLint
	npx eslint src/

validate: $(OUTPUT)  ## Validate the built .user.js
	@echo "── Validating $(OUTPUT) ──"
	@# Must start with UserScript metadata block
	@head -1 $(OUTPUT) | grep -q '// ==UserScript==' \
		|| { echo "FAIL: missing ==UserScript== header"; exit 1; }
	@grep -q '// ==/UserScript==' $(OUTPUT) \
		|| { echo "FAIL: missing ==/UserScript== footer"; exit 1; }
	@# Required grants
	@for grant in GM_xmlhttpRequest GM_setValue GM_getValue GM_registerMenuCommand; do \
		grep -q "@grant.*$$grant" $(OUTPUT) \
			|| { echo "FAIL: missing @grant $$grant"; exit 1; }; \
	done
	@# Must be an IIFE (not bare ES modules)
	@grep -q '^(function' $(OUTPUT) \
		|| { echo "FAIL: output is not an IIFE"; exit 1; }
	@# @run-at document-start is required for SES lockdown bypass
	@grep -q '@run-at.*document-start' $(OUTPUT) \
		|| { echo "FAIL: missing @run-at document-start"; exit 1; }
	@# Non-minified check (Greasy Fork compliance): avg line length should be reasonable
	@awk '{ total += length } END { if (NR > 0 && total/NR > 200) { print "FAIL: avg line length " int(total/NR) " — looks minified"; exit 1 } }' $(OUTPUT)
	@# Key functions must exist in the bundle
	@for fn in handleSubtitleData translateWithLLM translateChunkLLM \
		validateTranslation buildSystemPrompt runFullPass \
		togglePanel createOverlay handleKeydown startNetworkObserver; do \
		grep -q "function $$fn" $(OUTPUT) \
			|| { echo "FAIL: missing function $$fn"; exit 1; }; \
	done
	@echo "OK — all checks passed"

size: $(OUTPUT)  ## Show bundle size breakdown
	@echo "── Bundle size ──"
	@wc -c < $(OUTPUT) | awk '{ printf "  raw:  %6.1f KB\n", $$1/1024 }'
	@gzip -c $(OUTPUT) | wc -c | awk '{ printf "  gzip: %6.1f KB\n", $$1/1024 }'
	@echo "── Lines ──"
	@wc -l < $(OUTPUT) | awk '{ printf "  %d lines\n", $$1 }'
	@echo "── Source modules ──"
	@find src -name '*.js' | wc -l | awk '{ printf "  %d files\n", $$1 }'
	@wc -l src/**/*.js src/*.js 2>/dev/null | tail -1 | awk '{ printf "  %d lines (source)\n", $$1 }'

# ── Smoke test ───────────────────────────────────────────────

smoke: smoke-3b  ## Run quick smoke test (10 cues, 3B)

smoke-3b: | node_modules  ## Smoke test with qwen2.5:3b
	node src/headless/index.js --config only-3b --episode smoke-test

smoke-7b: | node_modules  ## Smoke test with qwen2.5:7b
	node src/headless/index.js --config only-7b --episode smoke-test

smoke-all: | node_modules  ## Run all smoke tests (Japanese + Korean + complex variants)
	node src/headless/index.js --config only-3b --episode smoke-test
	node src/headless/index.js --config only-3b --episode smoke-ja-action
	node src/headless/index.js --config only-3b --episode smoke-ko-drama
	node src/headless/index.js --config only-3b --episode smoke-ja-complex
	node src/headless/index.js --config only-3b --episode smoke-ko-complex

# ── Headless ─────────────────────────────────────────────────

headless: | node_modules  ## Translate+evaluate one episode
	node src/headless/index.js --config $(CONFIG) --episode $(EPISODE) $(if $(SOURCE_LANG),--source-lang $(SOURCE_LANG))

headless-all: | node_modules  ## Translate+evaluate all episodes
	node src/headless/index.js --config $(CONFIG) $(if $(SOURCE_LANG),--source-lang $(SOURCE_LANG))

headless-evaluate: | node_modules  ## Re-evaluate without retranslating
ifdef EPISODE
	node src/headless/index.js --config $(CONFIG) --episode $(EPISODE) --evaluate-only
else
	node src/headless/index.js --config $(CONFIG) --evaluate-only
endif

headless-analyze: | node_modules  ## Analyze translation quality
ifdef EPISODE
	node src/headless/analyze.js --config $(CONFIG) --episode $(EPISODE) $(if $(SOURCE_LANG),--source-lang $(SOURCE_LANG))
else
	node src/headless/analyze.js --config $(CONFIG)
endif

headless-replay: | node_modules  ## Re-evaluate with current rules (no LLM)
ifdef EPISODE
	node src/headless/replay.js --config $(CONFIG) --episode $(EPISODE) $(if $(COMMIT),--commit $(COMMIT))
else
	node src/headless/replay.js --config $(CONFIG) $(if $(COMMIT),--commit $(COMMIT))
endif

simulate-normalization: | node_modules  ## Simulate speaker name normalization (no LLM)
	node src/headless/simulate-normalization.js $(FILE)

headless-viewer: | node_modules  ## Generate and open interactive run viewer HTML
	node src/headless/run-viewer.js --config $(CONFIG) --episode $(EPISODE) $(if $(COMMIT),--commit $(COMMIT)) --open

headless-history: | node_modules  ## Show run history (HTML=1 for charts)
ifdef EPISODE
	node src/headless/run-history.js --config $(CONFIG) --episode $(EPISODE) $(if $(HTML),--html --open)
else
	node src/headless/run-history.js --config $(CONFIG) $(if $(HTML),--html --open)
endif

# ── Help ─────────────────────────────────────────────────────

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk -F ':.*## ' '{ printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }'
