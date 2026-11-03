"""Data for calibrating the AI-writing threshold. Everything it fetches or writes stays in
data/calibration/, which is git-ignored."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent.parent / "db"))
import migrate  # noqa: E402


def data_dir():
    return migrate.default_path().parent / "calibration"
