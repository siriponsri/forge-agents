"""Optional GUI-equivalent isolated dependency setup: python setup.py <data-dir>."""
from pathlib import Path
import subprocess
import sys
import venv

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Supply a dedicated absolute memory backend data directory')
    root = Path(sys.argv[1])
    if not root.is_absolute():
        raise SystemExit('Absolute data directory required')
    env = root / 'python-env'
    venv.EnvBuilder(with_pip=True).create(env)
    python = env / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '-r',
                    str(Path(__file__).with_name('requirements.txt'))], check=True)
    print('Dependencies installed. Local models and adapter health still require qualification.')
