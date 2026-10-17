#!/usr/bin/env python3
"""Build the native terminal frontend for the current OS/architecture."""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parent
subprocess.run(['cargo','build','--release','--locked','--manifest-path',str(ROOT/'tui/Cargo.toml')],check=True)
output=ROOT/'bin'/('oracle-leads-tui-'+sys.platform+'-'+platform.machine())
output.parent.mkdir(exist_ok=True)
with tempfile.NamedTemporaryFile(dir=output.parent,prefix='.build-',delete=False) as temporary:
    pending=Path(temporary.name)
try:
    shutil.copy2(ROOT/'tui/target/release/oracle-leads-tui',pending)
    pending.chmod(0o755)
    os.replace(pending,output)
finally:
    pending.unlink(missing_ok=True)
print('Built '+str(output))
