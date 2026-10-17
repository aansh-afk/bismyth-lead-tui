#!/usr/bin/env python3
"""Oracle Leads: outreach-only terminal workspace."""
import sys
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parent

def main():
    args = sys.argv[1:]
    if args[:1] == ['configure-selfhost']:
        import engine
        try:
            return engine.configure(args[1:])
        except (ValueError, OSError) as error:
            print(f'oracle: {error}', file=sys.stderr)
            return 1
    if args[:1] in (['exec'], ['review'], ['resume']):
        print('Oracle Leads is an outreach workspace. Use codex directly for coding tasks.', file=sys.stderr)
        return 2
    os.execv(sys.executable, [sys.executable, str(ROOT / 'leads/terminal.py'), *args])

if __name__ == '__main__':
    sys.exit(main())
