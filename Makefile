# Makefile for the local image generator
#
# Quick start:
#   make start                        # ComfyUI backend on localhost:8188
#   make start LOWVRAM=--lowvram      # ComfyUI backend with low-VRAM mode
#   make start-lowvram                # shorthand for the above
#   make dev                          # run this app (Next.js dev server)
#   make build && make start-app      # production build + serve

SHELL := /bin/bash

# --- ComfyUI backend -----------------------------------------------------------
COMFY_DIR ?= $(HOME)/pinokio/api/comfy.git/app
COMFY_HOST ?= 127.0.0.1
COMFY_PORT ?= 8188
# Optional extra flags, e.g. make start LOWVRAM=--lowvram
LOWVRAM ?=

.PHONY: start start-lowvram dev build start-app help

## Start the ComfyUI backend (this app's local image engine)
start:
	cd $(COMFY_DIR) && env/bin/python main.py --listen $(COMFY_HOST) --port $(COMFY_PORT) --force-fp16 $(LOWVRAM)

## Start ComfyUI with the --lowvram flag
start-lowvram: LOWVRAM := --lowvram
start-lowvram: start

## Run the Next.js app in development mode (default port 4000)
dev:
	npm run dev

## Build the Next.js app for production
build:
	npm run build

## Serve the production build of the Next.js app
start-app:
	npm run start

## List available targets
help:
	@while read -r line; do case "$$line" in "## "*) desc="$${line#\#\# }"; read -r line; name="$${line%%:*}"; printf "  %-14s %s\n" "$$name" "$$desc";; esac; done < $(MAKEFILE_LIST)
