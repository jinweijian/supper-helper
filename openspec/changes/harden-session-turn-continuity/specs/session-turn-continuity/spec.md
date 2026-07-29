## ADDED Requirements

### Requirement: Matching helper replies complete the accepted turn
The Web client SHALL use the public `user | helper` message contract and SHALL treat a `helper` message bound to the accepted `userMessageId` as completion before interpreting the Session terminal status.

#### Scenario: Preflight asks for more information
- **WHEN** an asynchronous turn returns a matching helper reply and Session status `need_input`
- **THEN** the Web client displays the reply and completes polling
- **AND** it does not display an interruption

### Requirement: Client waiting does not decide backend failure
Production polling SHALL continue while the Session is active and SHALL NOT convert a fixed client-side poll count or a transient transport failure into a backend interruption.

#### Scenario: Diagnosis exceeds the old polling limit
- **WHEN** a Session remains active beyond 120 half-second polls
- **THEN** the client continues polling without declaring the turn interrupted

#### Scenario: Session API temporarily disconnects
- **WHEN** a polling request fails and a later request succeeds
- **THEN** the client exposes reconnecting state and resumes the same turn
- **AND** client cancellation during navigation does not display an interruption

### Requirement: Startup marks inherited active turns retryable
Before accepting HTTP requests, a new server process SHALL convert every persisted `queued`, `ready_for_diagnosis`, or `diagnosing` Case inherited from the previous process into an explicit, retryable interruption without automatically invoking a Worker.

#### Scenario: Service restarts during Preflight
- **WHEN** a persisted active Case has an unanswered user message and no Run
- **THEN** startup marks the Case partial, writes one structured `turn_interrupted` event, and adds one interruption helper bound to that user message
- **AND** repeating recovery does not duplicate the event or helper

#### Scenario: Service restarts during a Run
- **WHEN** a persisted active Case contains queued or running Runs
- **THEN** startup marks those Runs partial and preserves them for audit
- **AND** Session serialization exposes a retryable turn for the unanswered user message

### Requirement: Users can retry the original interrupted turn
The Runtime SHALL allow one retry of a startup-interrupted turn by reusing its original `userMessageId`, removing only its system interruption placeholder, and entering the existing complete-turn pipeline.

#### Scenario: Retry is accepted
- **WHEN** the client retries a valid startup-interrupted turn
- **THEN** the system keeps the original user message and historical partial Runs/logs
- **AND** it removes the recorded interruption placeholder, records retry start, and produces the formal helper reply through the existing pipeline

#### Scenario: Retry is invalid or duplicated
- **WHEN** the Case is archived, the message does not exist, a formal reply already exists, the interruption is not retryable, or retry has already started
- **THEN** the Runtime rejects the retry without invoking the Worker or changing unrelated messages

### Requirement: Retryability is exposed as structured public state
Session responses SHALL expose retryability through an optional `retryableTurn` DTO derived from structured persisted facts and SHALL NOT require clients to parse interruption prose.

#### Scenario: Session contains a startup interruption
- **WHEN** a Case has a valid `turn_interrupted` record that has not been retried or formally answered
- **THEN** `/api/session` returns `retryableTurn` with the original user message ID, interruption time, and stable reason code
- **AND** old Cases and non-retryable Sessions omit the optional field

### Requirement: Retry is a narrow asynchronous HTTP operation
Gateway SHALL expose `POST /api/chat/retry` as transport over the Runtime retry use case and SHALL preserve asynchronous chat response semantics.

#### Scenario: Valid retry request is submitted
- **WHEN** the request contains a valid `caseId` and retryable `userMessageId`
- **THEN** Gateway returns 202 accepted before asynchronous completion
- **AND** polling observes the same user message receive its formal helper reply

#### Scenario: Invalid retry request is submitted
- **WHEN** identifiers are malformed, missing, not found, or not currently retryable
- **THEN** Gateway returns the corresponding 400, 404, or 409 response without implementing retry decisions in the route
