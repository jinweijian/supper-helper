## ADDED Requirements

### Requirement: Case paths remain inside the Case directory
Every Case load, save, and delete SHALL validate the identifier as a safe path segment and SHALL verify the resolved path is contained by the configured Case directory.

#### Scenario: Traversal identifier is requested
- **WHEN** an HTTP request supplies `../`, encoded separators, dot segments, or path punctuation as caseId
- **THEN** the gateway returns 400 and no file outside the Case directory is read, written, or deleted

### Requirement: Request input is bounded
The gateway SHALL reject JSON bodies larger than 1,048,576 bytes and chat messages larger than 65,536 UTF-8 bytes with status 413.

#### Scenario: Oversized request is followed by a valid request
- **WHEN** an oversized request is rejected and a normal request is then sent on a new connection
- **THEN** the normal request succeeds and server state remains usable

### Requirement: Public errors are stable and secret-safe
Unknown server failures SHALL return a generic public error and SHALL persist or print only redacted bounded diagnostics.

#### Scenario: Error includes credentials and local path
- **WHEN** an internal exception contains Authorization, token, password, cookie, or an absolute path
- **THEN** the HTTP response and persisted diagnostic output contain none of those raw values

### Requirement: Case writes are atomic
The file-backed repository SHALL preserve the last valid Case file when a replacement write or rename fails.

#### Scenario: Write fails before rename
- **WHEN** a fault is injected after the temporary file is created but before rename completes
- **THEN** the previous Case remains parseable and temporary artifacts are not listed as Cases

### Requirement: LAN remains intentionally unauthenticated
This change SHALL preserve the existing LAN bind option and warning without adding authentication or authorization behavior.

#### Scenario: LAN dry run
- **WHEN** dashboard starts with `--bind lan --dry-run`
- **THEN** it binds to `0.0.0.0` and reports the existing trusted-network warning
