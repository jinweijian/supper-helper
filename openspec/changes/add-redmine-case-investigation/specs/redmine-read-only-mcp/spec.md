## ADDED Requirements

### Requirement: Redmine MCP SHALL be an independent read-only server
The system SHALL provide a standalone Redmine MCP server that exposes only historical-case read operations and does not import runtime, gateway, worker, session, or knowledge orchestration.

#### Scenario: Development uses stdio
- **WHEN** the server is configured with `transport=stdio`
- **THEN** it SHALL expose the same tool names and schemas through `StdioServerTransport`

#### Scenario: Production uses Streamable HTTP
- **WHEN** the server is configured with `transport=http`
- **THEN** it SHALL expose the same tool names and schemas through Streamable HTTP
- **AND** it SHALL reject a request with an absent or invalid configured transport Bearer token

### Requirement: Redmine REST access SHALL be GET-only and fixed-scope
The Redmine adapter MUST issue only GET requests against one configured base URL and MUST send the dedicated API Key only through `X-Redmine-API-Key`.

#### Scenario: Tool input attempts to select a URL or method
- **WHEN** a caller supplies an arbitrary URL, HTTP method, header, or credential
- **THEN** the tool schema SHALL reject the input before any Redmine request

#### Scenario: Adapter reads Redmine
- **WHEN** the adapter sends a valid search or issue-detail request
- **THEN** the request method SHALL be GET
- **AND** its origin SHALL equal the configured base URL origin
- **AND** no Redmine API Key SHALL appear in the URL, response, event, or error

### Requirement: Redmine search SHALL remain inside the configured project allowlist
The server SHALL own an alias-to-numeric-project-ID mapping and SHALL return only issues whose numeric project ID belongs to the requested aliases and the server mapping.

#### Scenario: Model selects an allowed subset
- **WHEN** a search requests one or more configured project aliases
- **THEN** the server SHALL search only those aliases and validate every returned candidate's numeric project ID

#### Scenario: Search returns an issue from another project
- **WHEN** a Redmine search result belongs to a numeric project outside the selected mapping
- **THEN** the server SHALL omit it from the MCP result

### Requirement: Redmine search backend SHALL be explicit and bounded
The server SHALL use one startup-resolved backend, either `rest_search` or `issues_scan`, and SHALL apply configured page, history-window, cache, result, and timeout limits.

#### Scenario: REST search backend is selected
- **WHEN** startup configuration selects `rest_search`
- **THEN** the adapter SHALL use `/search.json` with issue filtering
- **AND** it SHALL validate candidate project membership through controlled issue reads

#### Scenario: Issues scan backend is selected
- **WHEN** startup configuration selects `issues_scan`
- **THEN** the adapter SHALL call `/issues.json` per allowed numeric project with `status_id=*`
- **AND** it SHALL stop at the configured page and time budgets

#### Scenario: Selected backend fails during a request
- **WHEN** the startup-resolved backend returns an error or timeout
- **THEN** the request SHALL return a safe failure
- **AND** it MUST NOT silently switch backend or expand project scope

### Requirement: Search tool SHALL return at most ten bounded candidates
The server SHALL expose `redmine_search_issues` with a schema-bounded query, signals, project aliases, status scope, optional update time, and limit no greater than 10.

#### Scenario: Search succeeds
- **WHEN** the caller invokes `redmine_search_issues` with valid allowed projects
- **THEN** the result SHALL contain a new `searchId`, no more than 10 candidates, and a truncation indicator
- **AND** each candidate SHALL contain only the approved candidate field whitelist

#### Scenario: Search has no candidates
- **WHEN** no allowed issue matches the bounded search
- **THEN** the result SHALL contain an empty candidates array
- **AND** it SHALL NOT fabricate a historical case or conclusion

### Requirement: Detail tool SHALL be authorized by the current search candidates
The server SHALL expose `redmine_get_issue_case_details` and MUST accept only 1 to 3 unique issue IDs covered by a live `searchId` grant.

#### Scenario: Caller reads selected candidates
- **WHEN** a valid `searchId` and up to three candidate issue IDs are supplied
- **THEN** the server SHALL fetch only those issues
- **AND** it SHALL revalidate their project membership

#### Scenario: Caller reads an unsearched or expired issue
- **WHEN** an issue ID is absent from the grant or the `searchId` has expired
- **THEN** the server SHALL reject the request before making a Redmine detail request

### Requirement: Redmine MCP output SHALL enforce privacy and data minimization
The server MUST anonymize people, omit private notes unless explicitly enabled by server and workspace policy, and return attachment metadata without attachment body or download credential.

#### Scenario: Private notes are disabled
- **WHEN** issue details contain private journals and private-note access is not enabled
- **THEN** those journals SHALL be absent from the result

#### Scenario: Identity fields are present
- **WHEN** an issue, journal, assignment, or observer includes a person's name, email, username, or network identifier
- **THEN** the result SHALL contain only a stable anonymous ID

#### Scenario: Issue has attachments
- **WHEN** issue details contain attachments
- **THEN** the result MAY include approved metadata such as filename, MIME type, size, and creation time
- **AND** it MUST NOT include attachment bytes, download URLs, cookies, or tokens

### Requirement: Historical case results SHALL be structurally bounded
The server SHALL keep each details result at or below 48,000 characters by removing or truncating complete schema fields and MUST NOT cut serialized JSON at an arbitrary character.

#### Scenario: Details exceed the output budget
- **WHEN** normalized details exceed 48,000 characters
- **THEN** the server SHALL preserve valid JSON and complete evidence-block records
- **AND** it SHALL report omitted counts or truncated fields

#### Scenario: Redmine returns a sensitive raw error
- **WHEN** Redmine returns an authentication, authorization, rate, timeout, transport, or server error containing raw payload
- **THEN** the MCP result SHALL expose only a stable safe error code

### Requirement: Redmine MCP verification SHALL be offline by default
Default build and test commands MUST use fixtures or fake transports and MUST NOT require a real Redmine URL or credential.

#### Scenario: Default test suite runs
- **WHEN** `pnpm test` executes without Redmine environment variables
- **THEN** all Redmine MCP tests SHALL run offline

#### Scenario: Operator requests a real smoke test
- **WHEN** the explicit real-acceptance script runs with required environment variables
- **THEN** it SHALL perform only tool discovery, bounded search, and authorized detail reads

