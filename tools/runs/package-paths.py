"""Print the archive paths owned by pip, coalescing fully installed directories."""

import csv
import json
import os
import stat
import sys


def fail(error):
    raise error


def packaged():
    owned = set()
    directories = {}
    candidates = set()
    for folder, dirs, files in os.walk(".", onerror=fail):
        folder = os.path.normpath(folder)
        directories[folder] = [os.path.normpath(os.path.join(folder, n)) for n in dirs + files]
        if not folder.endswith(".dist-info") or "RECORD" not in files:
            continue
        record = os.path.join(folder, "RECORD")
        if not stat.S_ISREG(os.lstat(record).st_mode):
            continue
        site = os.path.dirname(folder)
        with open(record, encoding="utf-8", newline="") as source:
            for row in csv.reader(source):
                if len(row) != 3 or not row[0]:
                    continue
                path = os.path.normpath(os.path.join(site, row[0]))
                if os.path.isabs(path) or path == ".." or path.startswith("../"):
                    continue
                relative = os.path.relpath(path, site or ".")
                if relative == ".":
                    continue
                if relative == ".." or relative.startswith("../"):
                    # A wheel may also install scripts in its environment's bin directory.
                    parent = os.path.dirname(path)
                    if os.path.basename(parent) == "bin" and os.path.dirname(parent) in ancestors(site):
                        owned.add(path)
                    continue
                owned.add(path)
                parent = os.path.dirname(path)
                while parent != site and parent not in candidates:
                    candidates.add(parent)
                    parent = os.path.dirname(parent)

    # A RECORD names files. Only the directory listing can establish that every child is owned. A
    # `__pycache__` written after the install (uv compiles nothing) is in no RECORD and goes as cached.
    owned.difference_update(directories)
    for folder, entries in reversed(directories.items()):
        mine = [entry for entry in entries if os.path.basename(entry) != "__pycache__"]
        if folder in candidates and mine and all(entry in owned for entry in mine):
            owned.difference_update(entries)
            owned.add(folder)
    return sorted(owned)


def ancestors(path):
    parents = set()
    while path:
        path = os.path.dirname(path)
        parents.add(path)
    return parents


json.dump(packaged(), sys.stdout)
