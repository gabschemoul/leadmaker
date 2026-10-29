#!/bin/bash
# Arrête les interfaces et les liens Internet. Le scan et le bot de contact s'arrêtent depuis leur interface (⏹️).
cd "$(dirname "$0")" || exit 1
pkill -f "streamlit run .*$(pwd)" 2>/dev/null
pkill -f "$(pwd)/bin/cloudflared" 2>/dev/null
echo "Interfaces et liens arrêtés."
