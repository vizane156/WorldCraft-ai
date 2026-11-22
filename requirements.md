# WorldCraft AI — Requirements

## 1. User Flow

```
1. User puts on Meta Quest headset and opens WorldCraft AI.
2. Application requests passthrough permission and initializes the Meta IWSDK.
3. The IWSDK scans the room and surfaces detected planes (tables, floors).
4. The app highlights horizontal surface candidates and prompts the user to confirm placement.
5. User reaches out and pinches/taps a highlighted surface to confirm it as the scene origin.
6. A floating text input widget appears above the confirmed surface.
7. User speaks or types a natural-language command (e.g. "Create a small Japanese market with two stalls, a fountain, and a red motorcycle").
8. The command is sent to the backend; a loading indicator appears.
9. The backend calls Gemini, validates the JSON response, and returns a structured scene command.
10. The Scene Engine executes the validated commands on the client, placing 3D assets on the confirmed surface.
11. The scene is persisted to the backend (scene state saved to PostgreSQL).
12. User can grab, move, rotate, and scale any object using hand tracking.
13. After each interaction, the updated scene state is sent to the backend and persisted.
14. User issues a follow-up AI command (e.g. "Move the red motorcycle in front of shop 2").
15. Backend resolves the command against the current scene state and returns a delta scene command.
16. Scene Engine applies the delta.
17. Updated state is persisted.
18. User can reset the scene or end the session.
```

---

## 2. Functional Requirements

### 2.1 Surface Detection and Confirmation

- FR-01: The application SHALL use the Meta IWSDK to detect horizontal physical surfaces (tables, desks) in the user's environment.
- FR-02: Detected surfaces SHALL be visually highlighted in the mixed-reality view.
- FR-03: The user SHALL confirm the placement surface using a hand pinch or tap gesture.
- FR-04: Only one surface SHALL be active as the scene origin per session.

### 2.2 Natural-Language Scene Creation

- FR-05: The application SHALL accept a natural-language text command from the user.
- FR-06: The command SHALL be sent to the backend over HTTPS.
- FR-07: The backend SHALL call the Gemini API with the user's command and the asset catalog.
- FR-08: Gemini SHALL return a JSON payload conforming to the WorldCraft Scene Command Schema (see Design §7).
- FR-09: The backend SHALL validate the Gemini response against the schema before forwarding it to the client.
- FR-10: The client Scene Engine SHALL execute only the validated, supported actions listed in the schema.
- FR-11: Assets referenced in the command SHALL only be drawn from the static, known asset catalog.
- FR-12: Any asset reference not present in the catalog SHALL be silently ignored and logged.

### 2.3 Scene Interaction

- FR-13: The user SHALL be able to grab, move, rotate, and scale any placed object using hand tracking.
- FR-14: Transformations SHALL be applied in world space relative to the confirmed surface origin.
- FR-15: Minimum and maximum scale limits SHALL be enforced per object (see Design §6).
- FR-16: Objects SHALL NOT be moved outside a configurable boundary radius around the surface origin.

### 2.4 Follow-up AI Commands

- FR-17: The user SHALL be able to issue follow-up natural-language commands while the scene is active.
- FR-18: Follow-up commands SHALL be resolved against the current scene state (existing objects, their IDs, positions, and properties).
- FR-19: The current scene state SHALL be included in the Gemini context when processing a follow-up command.
- FR-20: The backend SHALL return a delta command (add, move, remove, modify) rather than re-creating the full scene.

### 2.5 Persistence

- FR-21: The scene state SHALL be persisted to PostgreSQL after every successful Scene Engine execution.
- FR-22: The scene state SHALL be persisted after every user-initiated object transformation.
- FR-23: On session resume, the last persisted scene state SHALL be restored.
- FR-24: Each scene version SHALL be stored with a timestamp for lightweight history.

### 2.6 Error Handling

- FR-25: If Gemini returns an invalid or non-conforming JSON payload, the backend SHALL return a structured error to the client without executing any scene changes.
- FR-26: If no valid actions can be extracted from a Gemini response, the client SHALL display a user-facing error message.
- FR-27: Network errors SHALL be surfaced to the user with a retry option.

---

## 3. Non-Functional Requirements

### 3.1 Performance

- NFR-01: Surface detection SHALL initialize within 5 seconds of application launch on a Meta Quest 3.
- NFR-02: The full round-trip from command submission to first asset appearing in scene SHALL be under 5 seconds under normal network conditions (< 100 ms LAN latency to backend).
- NFR-03: Scene Engine asset placement SHALL complete within 500 ms of receiving a validated command.
- NFR-04: Hand interaction (grab/move/rotate/scale) SHALL maintain at least 72 fps.

### 3.2 Reliability

- NFR-05: The Gemini integration SHALL retry once on transient 5xx errors before returning an error to the client.
- NFR-06: Scene state persistence SHALL be atomic; a failed write SHALL NOT corrupt the existing state.

### 3.3 Security

- NFR-07: All client-backend communication SHALL use HTTPS with TLS 1.2+.
- NFR-08: Gemini API keys SHALL be stored server-side only, never exposed to the client.
- NFR-09: User input SHALL be sanitized before being included in any Gemini prompt.
- NFR-10: The backend SHALL reject any command payload that does not conform to the expected request schema.

### 3.4 Maintainability

- NFR-11: The asset catalog SHALL be defined as a single, versioned JSON file that can be updated without redeploying the application.
- NFR-12: The Scene Command Schema SHALL be defined in a shared JSON Schema file used for both backend validation and client-side type generation.

### 3.5 Testability

- NFR-13: The Scene Engine SHALL be independently testable without the Meta IWSDK (headless mode using mocked surface data).
- NFR-14: The Gemini integration layer SHALL be mockable via a configurable stub that returns fixture JSON responses.

---

## 4. MVP Boundaries

### In scope

- Meta Quest 3 (and Quest 3S) only.
- Horizontal surface detection and single-surface placement.
- Natural-language scene creation via text input.
- A fixed, curated asset catalog (see Design §6 for catalog structure).
- Follow-up commands that move, remove, or modify existing scene objects.
- Hand-tracking interaction: grab, move, rotate, scale.
- Scene persistence (single-user, single-scene per session).
- FastAPI + PostgreSQL backend.
- Gemini API integration (text-only prompt, structured JSON output).

### Explicitly out of scope for MVP

- Free-form or AI-generated 3D geometry.
- Voice input (text input only for MVP).
- Marketplace or asset store.
- Multiplayer or shared scenes.
- Authentication and user accounts (session token only, no registration/login UI).
- Vertical surface placement (walls).
- Physics simulation.
- Lighting or weather changes via AI command.
- Mobile (non-XR) client.
- Undo/redo history UI.

---

## 5. Acceptance Criteria

| ID    | Criterion |
|-------|-----------|
| AC-01 | The application detects at least one horizontal surface within 5 seconds of launch on a Meta Quest 3 in a room with a visible table. |
| AC-02 | Tapping a highlighted surface confirms it as the placement origin; the highlight changes to a confirmed state indicator. |
| AC-03 | A valid natural-language command produces a non-empty 3D scene with at least one recognizable asset placed on the surface within 5 seconds. |
| AC-04 | An unrecognized asset name in a Gemini response is ignored; the rest of the scene is placed correctly and a console warning is emitted. |
| AC-05 | The follow-up command "Move the red motorcycle in front of shop 2" updates only the motorcycle's position; all other objects are unchanged. |
| AC-06 | A user can grab, move, and release an object; its new position persists after the hand is withdrawn. |
| AC-07 | Scene state written to the database is readable on the next cold-start session resume without data loss. |
| AC-08 | An invalid Gemini JSON response results in a user-facing error with no scene change. |
| AC-09 | The Gemini API key is never present in any client-side network request, HTML, or JavaScript bundle. |
| AC-10 | All API calls between client and backend use HTTPS. |
