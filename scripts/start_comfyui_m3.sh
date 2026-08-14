#!/bin/bash
# NSFW-App · Optimized ComfyUI Launcher for MacBook M3 Pro 18GB
# Usage: put this script in your ComfyUI root folder and run: ./start_comfyui_m3.sh

set -e

echo "=========================================="
echo "  NSFW-App ComfyUI Launcher (M3 Pro 18GB)"
echo "=========================================="

# Detect if we are already inside ComfyUI directory
if [ ! -f "main.py" ]; then
  echo "Error: Please run this script from your ComfyUI root directory (where main.py is)."
  exit 1
fi

# Recommended flags for 18GB Unified Memory
# --force-fp16     : lower memory, good speed on Apple Silicon
# --lowvram        : more aggressive memory saving
# --use-pytorch-cross-attention : better compatibility
# You can remove --lowvram later if you want more speed and have headroom

EXTRA_ARGS="--force-fp16 --lowvram --use-pytorch-cross-attention"

# Optional: increase MPS high watermark if you still hit limits (use with caution)
# export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0

echo "Launching with: python main.py $EXTRA_ARGS"
echo "Press Ctrl+C to stop."
echo ""

python main.py $EXTRA_ARGS
