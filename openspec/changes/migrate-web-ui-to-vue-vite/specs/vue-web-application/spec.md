## ADDED Requirements

### Requirement: Production UI is built from Vue components
Dashboard and Setup SHALL be compiled by Vite from Vue single-file components and SHALL NOT embed their application logic as one server-side HTML template string.

#### Scenario: Production build completes
- **WHEN** `pnpm build` runs on Node 20.19 or newer
- **THEN** `dist/public` contains Dashboard and Setup HTML entries plus versioned JS/CSS assets, and the server build remains available

### Requirement: Existing page routes remain reloadable
The server SHALL return the correct built app shell for `/`, `/sessions/:id`, and `/setup`, including direct browser reloads.

#### Scenario: Shared session URL is opened directly
- **WHEN** a browser navigates directly to `/sessions/case_valid`
- **THEN** the Dashboard loads and initializes that Case route without a 404

### Requirement: UI responsibilities are independently testable
Session, chat, polling, logs, settings, knowledge health, Setup draft, review, and run progress SHALL be owned by focused components or composables.

#### Scenario: Chat polling returns a helper reply
- **WHEN** the API accepts an async message and later returns the matching helper reply
- **THEN** the chat composable stops polling, binds the reply to the submitted message, and updates the visible Case state

### Requirement: Browser interactions are accessible
Drawer and dialog interactions SHALL support Escape, intentional initial focus, focus restoration, and visible request errors.

#### Scenario: Log drawer is closed with Escape
- **WHEN** keyboard focus is inside the open log drawer and Escape is pressed
- **THEN** the drawer closes and focus returns to the control that opened it

### Requirement: Browser acceptance uses production assets and real HTTP
Playwright acceptance SHALL start the compiled Node server and exercise built assets over HTTP rather than mounting isolated mocked components.

#### Scenario: End-to-end dashboard workflow
- **WHEN** the smoke suite creates a Case, sends a message, waits for a reply, opens logs, edits settings, and changes session URL
- **THEN** each action is observable through the real Gateway endpoints and built Vue UI
