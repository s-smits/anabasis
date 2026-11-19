"""Read a submission inside the command wall: answer.json as `head -c` read it, links followed, since
the wall bounds what it reaches, and the deliverables folder without following a link."""
import base64
import json
import os
import stat
import sys


def regular(parent, name, limit, strict=True):
    """Read at most limit bytes, one more where strict so that an excess is refused here; the
    answer is read as the old `head -c` read it, and the host's format check names its size."""
    fd = os.open(name, os.O_RDONLY | (os.O_NOFOLLOW if strict else 0) | os.O_NONBLOCK, dir_fd=parent)
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError(f"{name} is not a regular file")
        data = stream.read(limit + 1 if strict else limit)
        if strict and len(data) > limit:
            raise ValueError(f"{name} is larger than the {limit} bytes allowed")
        return data


def walk(parent, prefix, files, remaining, count):
    for name in sorted(os.listdir(parent)):
        if "\\" in name:
            raise ValueError(f"{name} holds a backslash, which no deliverable path may")
        path = f"{prefix}/{name}" if prefix else name
        mode = os.stat(name, dir_fd=parent, follow_symlinks=False).st_mode
        if stat.S_ISDIR(mode):
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                remaining = walk(fd, path, files, remaining, count)
            finally:
                os.close(fd)
        elif stat.S_ISREG(mode):
            if len(files) >= count:
                raise ValueError(f"the folder holds more than {count} files")
            data = regular(parent, name, remaining)
            remaining -= len(data)
            files.append({"path": path, "base64": base64.b64encode(data).decode("ascii")})
        else:
            raise ValueError(f"{path} is a symlink or is not a regular file or directory")
    return remaining


def capture():
    home, answer_name, answer_limit, folder_name, count, total = sys.argv[1:]
    root = os.open(home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            answer = regular(root, answer_name, int(answer_limit), strict=False)
        except FileNotFoundError:
            sys.exit(44)
        files = []
        try:
            folder = os.open(folder_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
        except FileNotFoundError:
            folder = None
        if folder is not None:
            try:
                walk(folder, "", files, int(total), int(count))
            finally:
                os.close(folder)
        return {"answer": base64.b64encode(answer).decode("ascii"), "files": files}
    finally:
        os.close(root)


try:
    # One line under a mark: the wall hands back what the interpreter said beside it in the same bytes.
    print("ana-capture:" + json.dumps(capture()))
except (OSError, ValueError, RecursionError) as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
