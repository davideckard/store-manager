VERSION  ?= $(shell date +%Y%m%d)
DIST_DIR := dist
ARCHIVE  := $(DIST_DIR)/store-manager-$(VERSION).zip

.PHONY: dist clean

dist: $(ARCHIVE)

$(ARCHIVE):
	@mkdir -p $(DIST_DIR)
	@zip -r $(ARCHIVE) \
		Dockerfile docker-compose.yml \
		package.json package-lock.json \
		next.config.ts tsconfig.json tailwind.config.ts postcss.config.mjs \
		src/ prisma/ worker/ public/
	@echo "Created $(ARCHIVE)"

clean:
	@rm -rf $(DIST_DIR)
	@echo "Cleaned $(DIST_DIR)"
