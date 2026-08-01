#!/usr/bin/env python3
"""Validate a public E4A bundle or public repository checkout.

The public repository is intentionally narrow: it may contain the rendered
student site, public Colab notebooks, the public helper module, public docs,
GitHub Pages workflow files, and this validator. It must not contain raw
authoring source or material intended only for course staff.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


SKIP_DIRS = {
    ".git",
    ".github/actions",
    ".jupyter_cache",
    ".quarto",
    "__pycache__",
    "node_modules",
}

TEXT_SUFFIXES = {
    "",
    ".bib",
    ".css",
    ".csv",
    ".html",
    ".ipynb",
    ".js",
    ".jsonc",
    ".json",
    ".md",
    ".py",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}

ALLOWED_ROOT_FILES = {
    ".gitignore",
    "CONTRIBUTING.md",
    "LICENSE.md",
    "README.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    "wrangler.jsonc",
}

ALLOWED_TOP_LEVEL_DIRS = {
    ".github",
    "english-for-ai-course",
    "functions",
    "scripts",
    "site",
}

PUBLIC_NOTEBOOK_MANIFEST = "english-for-ai-course/interactives/public_notebooks.txt"
SAFE_NOTEBOOK_NAME = re.compile(r"^[A-Za-z0-9._-]+\.ipynb$")
CUSTOM_DOMAIN = "e4ai.zoni.edu"

LIVECODES_ROOT = "site/livecodes"
LIVECODES_MANIFEST = f"{LIVECODES_ROOT}/asset-manifest.json"
LIVECODES_EXPECTED_MANIFEST = {
    "appVersion": "49",
    "archiveSha256": "e8ede45a372217283222f68ec0f0234d6d73524add88bb0b7a547f70d9fe9864",
    "fileCount": 297,
    "policyScriptSha256": "5c51423d04c8e9cd36a9cee78f8f4bee5466870d6d7bec2edd35aaf923ecc3d0",
    "sdkVersion": "0.14.1",
    "totalBytes": 5_453_603,
    "treeSha256": "965df3fb93023104cb1df50d1813ad201610a0f8edd32951fa1713b4909c7dad",
    "upstreamTreeSha256": "e57d99dae912b9079e0c9aeeb8d74d629df827d5348573b098b978d1088f1e7b",
}
LIVECODES_COURSE_OWNED_PATHS = {
    LIVECODES_MANIFEST,
    f"{LIVECODES_ROOT}/app.html",
    f"{LIVECODES_ROOT}/e4a-education-mode.js",
}
LIVECODES_MAX_FILE_BYTES = 25 * 1024 * 1024
PAGES_MAX_FILES = 20_000
GITHUB_MAX_SITE_BYTES = 1_000_000_000

FORBIDDEN_FILE_PATTERNS = [
    ("teacher guide source", re.compile(r"(^|/)teacher-guide\.qmd$", re.IGNORECASE)),
    ("answer key source", re.compile(r"(^|/)answer-key\.qmd$", re.IGNORECASE)),
    ("assessment rubrics source", re.compile(r"(^|/)assessment-rubrics\.qmd$", re.IGNORECASE)),
    ("instructor Quarto profile", re.compile(r"(^|/)_quarto-instructor\.ya?ml$", re.IGNORECASE)),
    ("lesson plan", re.compile(r"(^|/)lesson_plan\.md$", re.IGNORECASE)),
    ("course planning notes", re.compile(r"course[-_ ]?planning[-_ ]?notes", re.IGNORECASE)),
    ("private authoring docs", re.compile(r"private[-_ ]?authoring", re.IGNORECASE)),
    ("raw Quarto source", re.compile(r"\.qmd$", re.IGNORECASE)),
]

FORBIDDEN_TEXT_PATTERNS = [
    ("Teacher Notes", re.compile(r"\bTeacher Notes\b", re.IGNORECASE)),
    ("Answer Key", re.compile(r"\bAnswer Key\b", re.IGNORECASE)),
    ("Instructor Guide", re.compile(r"\bInstructor Guide\b", re.IGNORECASE)),
    ("assessment rubrics", re.compile(r"\bassessment rubrics\b", re.IGNORECASE)),
    ("instructor profile visibility", re.compile(r'when-profile="instructor"', re.IGNORECASE)),
    (
        "instructor content visibility",
        re.compile(r'content-visible\s+when-profile="instructor"', re.IGNORECASE),
    ),
    ("teacher-only", re.compile(r"\bteacher[- ]only\b", re.IGNORECASE)),
    ("instructor-only", re.compile(r"\binstructor[- ]only\b", re.IGNORECASE)),
    ("private authoring", re.compile(r"\bprivate authoring\b", re.IGNORECASE)),
    ("solution key", re.compile(r"\bsolution key\b", re.IGNORECASE)),
]

SECRET_PATTERNS = [
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{22,})\b")),
    ("OpenAI key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("bearer token", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{20,}", re.IGNORECASE)),
    ("private SSH key", re.compile(r"-----BEGIN (?:OPENSSH|RSA|DSA|EC|PRIVATE) PRIVATE KEY-----")),
    (
        "env-style secret assignment",
        re.compile(
            r"(?im)^\s*(?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*['\"]?[^'\"\s#]{8,}"
        ),
    ),
]

PRIVATE_DATA_PATTERNS = [
    ("possible SSN", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("possible email address", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    (
        "possible phone number",
        re.compile(r"\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}\b"),
    ),
    (
        "possible street address",
        re.compile(
            r"\b\d{1,5}\s+[A-Z][A-Za-z0-9.-]+(?:\s+[A-Z][A-Za-z0-9.-]+){0,3}\s+"
            r"(?:Street|St\.|Avenue|Ave\.|Road|Rd\.|Drive|Dr\.|Lane|Ln\.|Boulevard|Blvd\.)\b"
        ),
    ),
    (
        "possible private document request",
        re.compile(
            r"\b(?:paste|upload|share)\s+(?:your\s+)?"
            r"(?:passport|medical|immigration|tax|bank|school|employer)\s+"
            r"(?:record|document|file|letter)s?\b",
            re.IGNORECASE,
        ),
    ),
]

PUBLIC_REF_PATTERNS = [
    (
        "moving raw helper URL",
        re.compile(
            r"https://raw\.githubusercontent\.com/zoni-group/E4A/main/"
            r"english-for-ai-course/interactives/e4a_colab\.py",
            re.IGNORECASE,
        ),
    ),
    (
        "moving Colab notebook URL",
        re.compile(
            r"https://colab\.research\.google\.com/github/zoni-group/E4A/blob/main/"
            r"english-for-ai-course/interactives/",
            re.IGNORECASE,
        ),
    ),
]

IMMUTABLE_RAW_HELPER = re.compile(
    r"https://raw\.githubusercontent\.com/zoni-group/E4A/(?P<ref>[^/]+)/"
    r"english-for-ai-course/interactives/e4a_colab\.py"
)

IMMUTABLE_COLAB_NOTEBOOK = re.compile(
    r"https://colab\.research\.google\.com/github/zoni-group/E4A/blob/(?P<ref>[^/]+)/"
    r"english-for-ai-course/interactives/[A-Za-z0-9._-]+\.ipynb"
)

PUBLIC_TAG = re.compile(r"^public-[0-9a-f]{12}$")
VALIDATOR_TEXT_ALLOWLIST = {"scripts/validate_public_repo.py"}
EMAIL_ALLOWLIST_SUFFIXES = {
    "@example.com",
    "@example.org",
    "@example.net",
    "@users.noreply.github.com",
}
EMAIL_ALLOWLIST_EXACT = {
    "noreply@github.com",
}

# These files are pinned, generated third-party dependencies. Their upstream
# source may contain public maintainer addresses, which are not private course
# data. Keep this list exact and versioned so authored assets are still scanned.
THIRD_PARTY_EMAIL_ALLOWLIST_PATHS = {
    "site/assets/generated/plotly/plotly-3.7.0.min.js",
}


@dataclass(frozen=True)
class Finding:
    path: str
    label: str
    detail: str


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "root",
        nargs="?",
        default=".",
        help="Path to the public bundle or public repository checkout.",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    findings = validate(root)
    if findings:
        print("Public bundle validation failed:\n")
        for finding in findings:
            print(f"- {finding.path}: {finding.label}: {finding.detail}")
        return 1

    print(f"Public bundle validation passed: {root}")
    return 0


def validate(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    if not root.exists():
        return [Finding(str(root), "missing root", "path does not exist")]
    if not root.is_dir():
        return [Finding(str(root), "invalid root", "path is not a directory")]

    expected_notebooks = load_public_notebook_manifest(root, findings)
    validate_required_public_files(root, expected_notebooks, findings)
    validate_cloudflare_livecodes_policy(root, findings)
    validate_site_limits(root, findings)
    livecodes_verified = validate_livecodes_tree(root, findings)
    for path in iter_files(root):
        rel = path.relative_to(root).as_posix()
        validate_allowed_path(rel, expected_notebooks, findings)
        validate_forbidden_path(rel, findings)
        if not should_scan_text(path):
            continue
        text = read_text(path)
        if text is None:
            continue
        if (
            livecodes_verified
            and rel.startswith(f"{LIVECODES_ROOT}/")
            and rel not in LIVECODES_COURSE_OWNED_PATHS
        ):
            # The pinned upstream application contains public API keys,
            # maintainer data, and example templates. Exempt it only after the
            # complete patched tree has matched the reviewed digest. The
            # course-owned policy and bootstrap files are still scanned.
            continue
        validate_text(rel, text, findings)
    return findings


def load_public_notebook_manifest(root: Path, findings: list[Finding]) -> set[str]:
    manifest_path = root / PUBLIC_NOTEBOOK_MANIFEST
    if not manifest_path.is_file():
        findings.append(
            Finding(PUBLIC_NOTEBOOK_MANIFEST, "missing public notebook manifest", "file is required")
        )
        return set()

    expected: set[str] = set()
    text = read_text(manifest_path)
    if text is None:
        findings.append(Finding(PUBLIC_NOTEBOOK_MANIFEST, "invalid public notebook manifest", "not UTF-8 text"))
        return set()

    for lineno, raw_line in enumerate(text.splitlines(), start=1):
        name = raw_line.strip()
        if not name:
            continue
        if not SAFE_NOTEBOOK_NAME.fullmatch(name):
            findings.append(
                Finding(
                    PUBLIC_NOTEBOOK_MANIFEST,
                    "invalid public notebook name",
                    f"line {lineno}: {short(name)}",
                )
            )
            continue
        if name in expected:
            findings.append(
                Finding(
                    PUBLIC_NOTEBOOK_MANIFEST,
                    "duplicate public notebook name",
                    f"line {lineno}: {name}",
                )
            )
            continue
        expected.add(name)

    if not expected:
        findings.append(Finding(PUBLIC_NOTEBOOK_MANIFEST, "empty public notebook manifest", "no notebooks listed"))
    return expected


def validate_required_public_files(
    root: Path,
    expected_notebooks: set[str],
    findings: list[Finding],
) -> None:
    required = [
        "README.md",
        "LICENSE.md",
        "THIRD_PARTY_NOTICES.md",
        ".github/workflows/pages.yml",
        "functions/_middleware.js",
        "scripts/validate_public_repo.py",
        "site/CNAME",
        "site/index.html",
        "site/livecodes/LICENSE.txt",
        "site/livecodes/app.html",
        "site/livecodes/asset-manifest.json",
        "site/livecodes/e4a-education-mode.js",
        "site/livecodes/index.html",
        "wrangler.jsonc",
        "english-for-ai-course/interactives/e4a_colab.py",
    ]
    for rel in required:
        if not (root / rel).is_file():
            findings.append(Finding(rel, "missing required public artifact", "file is required"))

    notebook_dir = root / "english-for-ai-course" / "interactives"
    notebooks = {path.name for path in notebook_dir.glob("*.ipynb")}
    missing_notebooks = sorted(expected_notebooks - notebooks)
    if missing_notebooks:
        findings.append(
            Finding(
                "english-for-ai-course/interactives",
                "missing public notebooks",
                ", ".join(missing_notebooks),
            )
        )

    cname_path = root / "site" / "CNAME"
    cname_text = read_text(cname_path) if cname_path.is_file() else None
    if cname_text is not None and cname_text.strip() != CUSTOM_DOMAIN:
        findings.append(
            Finding(
                "site/CNAME",
                "unexpected Pages custom domain",
                f"expected {CUSTOM_DOMAIN}",
            )
        )


def validate_livecodes_tree(root: Path, findings: list[Finding]) -> bool:
    """Verify the exact reviewed LiveCodes tree before allowing scan exemptions."""

    finding_count = len(findings)
    livecodes_root = root / LIVECODES_ROOT
    manifest_path = root / LIVECODES_MANIFEST
    if not livecodes_root.is_dir():
        findings.append(Finding(LIVECODES_ROOT, "missing LiveCodes application", "directory is required"))
        return False
    if not manifest_path.is_file():
        findings.append(Finding(LIVECODES_MANIFEST, "missing LiveCodes manifest", "file is required"))
        return False

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        findings.append(Finding(LIVECODES_MANIFEST, "invalid LiveCodes manifest", "expected UTF-8 JSON"))
        return False
    if manifest != LIVECODES_EXPECTED_MANIFEST:
        findings.append(
            Finding(
                LIVECODES_MANIFEST,
                "unexpected LiveCodes manifest",
                "expected the pinned v49 app and SDK 0.14.1 metadata",
            )
        )

    files: list[Path] = []
    for path in livecodes_root.rglob("*"):
        if path.is_symlink():
            findings.append(
                Finding(path.relative_to(root).as_posix(), "unsafe LiveCodes asset", "symbolic links are not allowed")
            )
            continue
        if path.is_file() and path != manifest_path:
            files.append(path)
            if path.stat().st_size > LIVECODES_MAX_FILE_BYTES:
                findings.append(
                    Finding(
                        path.relative_to(root).as_posix(),
                        "oversized LiveCodes asset",
                        "file exceeds the Cloudflare Pages 25 MiB limit",
                    )
                )

    file_count = len(files)
    total_bytes = sum(path.stat().st_size for path in files)
    tree_sha256 = livecodes_tree_digest(livecodes_root, files)
    if file_count != LIVECODES_EXPECTED_MANIFEST["fileCount"]:
        findings.append(
            Finding(LIVECODES_ROOT, "unexpected LiveCodes file count", f"found {file_count}")
        )
    if total_bytes != LIVECODES_EXPECTED_MANIFEST["totalBytes"]:
        findings.append(
            Finding(LIVECODES_ROOT, "unexpected LiveCodes byte count", f"found {total_bytes}")
        )
    if tree_sha256 != LIVECODES_EXPECTED_MANIFEST["treeSha256"]:
        findings.append(
            Finding(LIVECODES_ROOT, "unexpected LiveCodes tree digest", f"found {tree_sha256}")
        )

    forbidden_parts = {"docs", "documentation", "stories", "storybook", "src"}
    for path in files:
        relative_parts = {part.lower() for part in path.relative_to(livecodes_root).parts[:-1]}
        if relative_parts & forbidden_parts:
            findings.append(
                Finding(
                    path.relative_to(root).as_posix(),
                    "unexpected LiveCodes content",
                    "documentation, Storybook, and source directories are excluded",
                )
            )

    return len(findings) == finding_count


def validate_cloudflare_livecodes_policy(root: Path, findings: list[Finding]) -> None:
    """Require the reviewed public LiveCodes exception in the auth middleware."""

    middleware_path = root / "functions/_middleware.js"
    if not middleware_path.is_file():
        return
    text = read_text(middleware_path)
    if text is None:
        return

    required_markers = (
        'url.pathname === "/livecodes"',
        'url.pathname.startsWith("/livecodes/")',
        "isPublicLiveCodesRequest(url)",
        "publicLiveCodesResponse(request, await context.next())",
        'publicResponse.headers.set("Access-Control-Allow-Origin", "*")',
        'publicResponse.headers.set("Cross-Origin-Resource-Policy", "cross-origin")',
        'publicResponse.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive")',
    )
    for marker in required_markers:
        if marker not in text:
            findings.append(
                Finding(
                    "functions/_middleware.js",
                    "missing public LiveCodes policy",
                    marker,
                )
            )


def validate_site_limits(root: Path, findings: list[Finding]) -> None:
    site_root = root / "site"
    if not site_root.is_dir():
        return

    for forbidden in ("node_modules", "_site", "_site-student", "_site-instructor"):
        if (site_root / forbidden).exists():
            findings.append(
                Finding(
                    f"site/{forbidden}",
                    "unexpected rendered payload",
                    "dependency and nested output directories must not be published",
                )
            )

    site_files = [path for path in site_root.rglob("*") if path.is_file()]
    if len(site_files) > PAGES_MAX_FILES:
        findings.append(
            Finding("site", "Cloudflare Pages file limit", f"found {len(site_files)} files")
        )
    total_bytes = sum(path.stat().st_size for path in site_files)
    if total_bytes >= GITHUB_MAX_SITE_BYTES:
        findings.append(
            Finding("site", "GitHub Pages site-size limit", f"found {total_bytes} bytes")
        )
    for path in site_files:
        if path.stat().st_size > LIVECODES_MAX_FILE_BYTES:
            findings.append(
                Finding(
                    path.relative_to(root).as_posix(),
                    "Cloudflare Pages file-size limit",
                    "file exceeds 25 MiB",
                )
            )


def livecodes_tree_digest(root: Path, files: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda candidate: candidate.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(file_sha256(path).encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_allowed_path(rel: str, expected_notebooks: set[str], findings: list[Finding]) -> None:
    parts = rel.split("/")
    if len(parts) == 1:
        if rel not in ALLOWED_ROOT_FILES:
            findings.append(Finding(rel, "unexpected root file", "not part of the public artifact allowlist"))
        return

    top = parts[0]
    if top not in ALLOWED_TOP_LEVEL_DIRS:
        findings.append(Finding(rel, "unexpected top-level directory", top))
        return

    if top == ".github":
        allowed = rel == ".github/CODEOWNERS" or rel == ".github/workflows/pages.yml"
        if not allowed:
            findings.append(Finding(rel, "unexpected GitHub metadata", "only CODEOWNERS and pages.yml are public"))
    elif top == "scripts":
        if rel != "scripts/validate_public_repo.py":
            findings.append(Finding(rel, "unexpected script", "only the public repository validator is allowed"))
    elif top == "functions":
        if rel != "functions/_middleware.js":
            findings.append(Finding(rel, "unexpected Pages Function", "only the auth middleware is allowed"))
    elif top == "english-for-ai-course":
        allowed_prefix = "english-for-ai-course/interactives/"
        if not rel.startswith(allowed_prefix):
            findings.append(Finding(rel, "unexpected course file", "only public Colab artifacts are allowed"))
            return
        name = parts[-1]
        if name in {"e4a_colab.py", "public_notebooks.txt"}:
            return
        if name.endswith(".ipynb"):
            if name not in expected_notebooks:
                findings.append(
                    Finding(rel, "unexpected public notebook", "not listed in public_notebooks.txt")
                )
            return
        findings.append(
            Finding(
                rel,
                "unexpected interactive artifact",
                "only public_notebooks.txt, .ipynb files, and e4a_colab.py are allowed",
            )
        )


def validate_forbidden_path(rel: str, findings: list[Finding]) -> None:
    for label, pattern in FORBIDDEN_FILE_PATTERNS:
        if pattern.search(rel):
            findings.append(Finding(rel, "forbidden file pattern", label))


def validate_text(rel: str, text: str, findings: list[Finding]) -> None:
    if rel not in VALIDATOR_TEXT_ALLOWLIST:
        for label, pattern in FORBIDDEN_TEXT_PATTERNS:
            for match in pattern.finditer(text):
                findings.append(Finding(rel, "forbidden text", f"{label}: {short(match.group(0))}"))

    for label, pattern in SECRET_PATTERNS:
        for match in pattern.finditer(text):
            findings.append(Finding(rel, "possible secret", f"{label}: {short(match.group(0))}"))

    for label, pattern in PRIVATE_DATA_PATTERNS:
        for match in pattern.finditer(text):
            value = match.group(0)
            if label == "possible email address" and email_is_allowed(value):
                continue
            if label == "possible email address" and rel in THIRD_PARTY_EMAIL_ALLOWLIST_PATHS:
                continue
            if label == "possible email address" and rel.startswith("site/site_libs/"):
                continue
            findings.append(Finding(rel, "possible private data", f"{label}: {short(value)}"))

    for label, pattern in PUBLIC_REF_PATTERNS:
        for match in pattern.finditer(text):
            findings.append(Finding(rel, "moving public ref", f"{label}: {short(match.group(0))}"))

    validate_immutable_public_refs(rel, text, findings)


def validate_immutable_public_refs(rel: str, text: str, findings: list[Finding]) -> None:
    for label, pattern in (
        ("raw helper URL", IMMUTABLE_RAW_HELPER),
        ("Colab notebook URL", IMMUTABLE_COLAB_NOTEBOOK),
    ):
        for match in pattern.finditer(text):
            ref = match.group("ref")
            if not PUBLIC_TAG.fullmatch(ref):
                findings.append(
                    Finding(
                        rel,
                        "non-immutable public ref",
                        f"{label} uses '{ref}', expected public-<12 hex chars>",
                    )
                )


def iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        rel_parts = path.relative_to(root).parts
        if any(part in SKIP_DIRS for part in rel_parts):
            continue
        files.append(path)
    return sorted(files)


def should_scan_text(path: Path) -> bool:
    return path.suffix.lower() in TEXT_SUFFIXES


def read_text(path: Path) -> str | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if b"\0" in data[:2048]:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def email_is_allowed(value: str) -> bool:
    lower = value.lower()
    return lower in EMAIL_ALLOWLIST_EXACT or any(lower.endswith(suffix) for suffix in EMAIL_ALLOWLIST_SUFFIXES)


def short(value: str) -> str:
    compact = " ".join(value.split())
    if len(compact) <= 120:
        return compact
    return compact[:117] + "..."


if __name__ == "__main__":
    sys.exit(main())
