"""Run explicitly to install/remove a user launchd task."""
import argparse
import os
import plistlib
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--remove", action="store_true")
parser.add_argument("--executable", help="Optional packaged TiboMonitorHelper executable (not the GUI app)")
args = parser.parse_args()
label = "org.tibo-reset.monitor"
plist = Path.home() / "Library/LaunchAgents" / (label + ".plist")
root = Path(__file__).resolve().parents[1]
domain = f"gui/{os.getuid()}"
if args.remove:
    subprocess.run(["launchctl", "bootout", domain + "/" + label], check=False)
    plist.unlink(missing_ok=True)
else:
    home = Path.home() / ".tibo-reset"
    home.mkdir(exist_ok=True)
    command = [str(Path(args.executable).resolve())] if args.executable else [sys.executable, "-m", "monitor"]
    command += ["--once", "--config", str(home / "monitor.config.json"),
                "--state", str(home / "state.sqlite3"), "--output", str(home / "data")]
    plist.parent.mkdir(parents=True, exist_ok=True)
    with plist.open("wb") as f:
        plistlib.dump({"Label": label, "ProgramArguments": command, "WorkingDirectory": str(root),
                      "StartInterval": 900, "RunAtLoad": True,
                      "StandardOutPath": str(home / "scheduler.log"),
                      "StandardErrorPath": str(home / "scheduler-error.log")}, f)
    subprocess.run(["launchctl", "bootout", domain + "/" + label], check=False, capture_output=True)
    subprocess.run(["launchctl", "bootstrap", domain, str(plist)], check=True)
print("Removed" if args.remove else "Installed: every 15 minutes while logged in")
