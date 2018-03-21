.PHONY: build

build: rating.user.js
rating.user.js: rating.user.ts
	tsc --target es2015 $<
