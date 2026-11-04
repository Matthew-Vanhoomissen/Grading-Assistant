"""Run student code with stdin and a timeout, isolated in a Docker container.

Each run gets a fresh container with no network, capped memory, CPU, and
process count, a read-only filesystem, no Linux capabilities, and an
unprivileged user. The code is mounted read-only; only /tmp is writable.

If Docker isn't available, run_code raises SandboxUnavailable instead of
quietly falling back to the host. SANDBOX=subprocess opts into a host
subprocess runner, which has a timeout but no network or memory isolation;
use it only with your own samples.
"""

import os
import subprocess
import sys
import tempfile
import uuid

DEFAULT_TIMEOUT = 5
MAX_OUTPUT_BYTES = 64 * 1024

SANDBOX_MODE = os.environ.get("SANDBOX", "docker")
DOCKER_IMAGE = os.environ.get("SANDBOX_IMAGE", "python:3.12-slim")
MEMORY_LIMIT = "256m"
CPU_LIMIT = "1"
PIDS_LIMIT = "64"
# Extra seconds for container startup before the host gives up on docker.
DOCKER_STARTUP_GRACE = 20
# Exit code from coreutils `timeout` when it stopped the program (SIGTERM).
TIMEOUT_EXIT_CODE = 124
# SIGKILL. Since `timeout` runs without -k, this comes from the memory limit.
KILLED_EXIT_CODE = 137
# Docker's own exit code when it fails to run the container at all.
DOCKER_FAILED_EXIT_CODE = 125


class SandboxUnavailable(RuntimeError):
    """Raised when Docker can't run the code (not installed, daemon down)."""


def run_code(code, stdin="", timeout=DEFAULT_TIMEOUT):
    """Run code as a script with the given stdin.

    Returns stdout, stderr, exit_code (None on timeout), and timed_out.
    Output beyond MAX_OUTPUT_BYTES is truncated.
    """
    with tempfile.TemporaryDirectory(prefix="grader_") as workdir:
        with open(os.path.join(workdir, "main.py"), "w",
                  encoding="utf-8") as f:
            f.write(code)
        if SANDBOX_MODE == "subprocess":
            return _run_subprocess(workdir, stdin, timeout)
        return _run_docker(workdir, stdin, timeout)


def _run_docker(workdir, stdin, timeout):
    """Run main.py from workdir in a locked-down, single-use container."""
    name = f"grader-{uuid.uuid4().hex[:12]}"
    command = [
        "docker", "run", "--rm", "-i", "--name", name,
        "--network", "none",
        "--memory", MEMORY_LIMIT, "--memory-swap", MEMORY_LIMIT,
        "--cpus", CPU_LIMIT, "--pids-limit", PIDS_LIMIT,
        "--read-only", "--tmpfs", "/tmp:size=16m",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--user", "65534:65534",
        "-v", f"{workdir}:/code:ro", "-w", "/code",
        DOCKER_IMAGE,
        # The time limit is enforced inside the container so the ~1 s of
        # container startup doesn't count against the student. If the
        # program ignores SIGTERM, the host-side timeout below kills it.
        "timeout", str(timeout), "python", "-I", "main.py",
    ]
    try:
        run = _run_to_files(workdir, command, stdin,
                            timeout + DOCKER_STARTUP_GRACE)
    except FileNotFoundError:
        raise SandboxUnavailable("docker is not installed or not on PATH")
    except subprocess.TimeoutExpired:
        # Killing the docker CLI doesn't stop the container, so kill it too.
        subprocess.run(["docker", "kill", name], capture_output=True)
        return {**_read_outputs(workdir), "exit_code": None,
                "timed_out": True}

    exit_code = run.returncode
    outputs = _read_outputs(workdir)
    if exit_code == DOCKER_FAILED_EXIT_CODE:
        # Docker itself failed (daemon down, missing image), not the
        # student's code.
        raise SandboxUnavailable(f"docker run failed: {outputs['stderr']}")
    if exit_code == KILLED_EXIT_CODE:
        outputs["stderr"] += (f"\nKilled: exceeded the {MEMORY_LIMIT}"
                              " memory limit")
    timed_out = exit_code == TIMEOUT_EXIT_CODE
    return {**outputs, "exit_code": None if timed_out else exit_code,
            "timed_out": timed_out}


def _run_subprocess(workdir, stdin, timeout):
    """Run main.py on the host with a timeout. No isolation beyond that."""
    # -X utf8 is needed because -I ignores PYTHONIOENCODING.
    command = [sys.executable, "-I", "-X", "utf8",
               os.path.join(workdir, "main.py")]
    try:
        run = _run_to_files(workdir, command, stdin, timeout,
                            env={"SYSTEMROOT": os.environ.get("SYSTEMROOT",
                                                              "")})
    except subprocess.TimeoutExpired:
        return {**_read_outputs(workdir), "exit_code": None,
                "timed_out": True}
    return {**_read_outputs(workdir), "exit_code": run.returncode,
            "timed_out": False}


def _run_to_files(workdir, command, stdin, timeout, env=None):
    """Run a command with its output redirected to files in workdir.

    Files instead of pipes mean an infinite print loop fills a file we only
    read the start of, not this process's memory.
    """
    with open(os.path.join(workdir, "stdout.txt"), "wb") as out, \
            open(os.path.join(workdir, "stderr.txt"), "wb") as err:
        return subprocess.run(command, input=stdin.encode("utf-8"),
                              stdout=out, stderr=err, cwd=workdir,
                              timeout=timeout, env=env)


def _read_outputs(workdir):
    """Return the captured stdout and stderr from workdir."""
    return {"stdout": _read_capped(os.path.join(workdir, "stdout.txt")),
            "stderr": _read_capped(os.path.join(workdir, "stderr.txt"))}


def _read_capped(path):
    """Read up to MAX_OUTPUT_BYTES of a file as text, marking truncation."""
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        data = f.read(MAX_OUTPUT_BYTES + 1)
    text = data[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")
    # Windows writes \r\n to redirected stdout; normalizing keeps exact-match
    # comparisons independent of the host OS.
    text = text.replace("\r\n", "\n")
    if len(data) > MAX_OUTPUT_BYTES:
        text += "\n[output truncated]"
    return text


def outputs_match(actual, expected, exact=False):
    """Return True if the program's output matches the expected output.

    By default, trailing whitespace on each line and trailing blank lines
    are ignored, since students and professors rarely agree on those. With
    exact=True, the strings must be identical.
    """
    if exact:
        return actual == expected
    return _normalize(actual) == _normalize(expected)


def _normalize(text):
    """Strip trailing whitespace from each line and trailing blank lines."""
    lines = text.replace("\r\n", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).rstrip("\n")
