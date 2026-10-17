#!/bin/sh
SCRIPT=$(readlink -f "$0")
exec python3 "$(dirname "$SCRIPT")/terminal.py" "$@"
