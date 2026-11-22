# WorldCraft AI — Implementation Tasks

Tasks are sequential within each phase. A task may only begin when all listed dependencies are complete. Each task has a concrete, independently verifiable outcome.

**Conventions:**
- `[B]` Backend · `[F]` Frontend · `[S]` Shared
- `Depends:` lists task IDs that must be complete first.

---

## Phase 0 — Project Scaffolding

### T-01 [S] Initialize repository structure
- Create monorepo root with two top-level directories: `frontend/` (the IWSDK starter) and `backend/`.
- Add root `.gitignore` covering Node, Python, `.env`, and build artifacts.
- Add root `README.md` with project description and placeholder dev instructions.
- **Verify:** `git status` shows tracked files; no `.env` committed.

### T-02 [B] Initialize Python backend project
- Inside `backend/`, create a virtual environment.
- Create `pyproject.toml` (or `requirements.txt`) with pinned deps: `fastapi`, `uvicorn[standard]`, `sqlalchemy[asyncio]`, `asyncpg`, `pydantic`, `pydantic-settings`, `jsonschema`, `google-genai`, `alembic`.
- Create `app/main.py` with a minimal FastAPI app returning `{ "status": "ok" }` on `GET /health`.
- **Verify:** `uvicorn app.main:app` starts; `GET /health` returns 200.
- Depends: T-01.

### T-03 [F] Initialize TypeScript frontend project with IWSDK starter
- The IWSDK starter project has already been generated via `npm create @iwsdk@latest` (Mixed Reality / Passthrough). It lives at `worldcraft-ai/worldcraft-ai/`.
- Confirm `npm run typecheck` passes on the unmodified starter.
- Confirm `npm run dev:runtime` starts Vite on port 8081 without errors.
- **Verify:** Vite serves the starter on `https://localhost:8081`; zero TypeScript errors.
- Depends: T-01.

### T-04 [S] Create shared schema and asset catalog stubs
- Create `backend/app/scene_command_schema.json` with the full strict schema from `design.md §8`.
- Create `backend/app/catalog/assets.json` with the three asset entries from `design.md §7.2`.
- Copy both files into `frontend/src/` as static assets consumed by TypeScript.
- **Verify:** Both JSON files parse without error (`python -m json.tool <file>`).
- Depends: T-01.

---

## Phase 1 — Desktop Vertical Slice

Goal: the complete scene-creation loop working in a standard desktop browser — no Quest, no backend, no real assets. Desktop mode is the primary development path.

### T-05 [F] Implement InteractionAdapter interface and event types
- Create `src/interaction/InteractionAdapter.ts` with:
  - `InteractionEvent` discriminated union (`surfaceConfirmed`, `objectSelected`, `objectMoved`, `objectRotated`, `objectScaled`, `objectReleased`) as defined in `design.md §3.2`.
  - `InteractionAdapter` interface (`update`, `on`, `dispose`).
- No implementation yet — interface and types only.
- **Verify:** `npm run typecheck` passes; the file exports the interface and event types correctly.
- Depends: T-03.

### T-06 [F] Implement SceneState registry
- Create `src/scene/SceneState.ts` — pure data structure, no Three.js or IWSDK dependency.
  - `add(obj: SceneObject): void`
  - `remove(id: string): void`
  - `update(id: string, transform: Partial<Transform>): void`
  - `resolve(label: string): SceneObject | undefined` (case-insensitive)
  - `serialize(): SceneSnapshot`
  - `deserialize(snapshot: SceneSnapshot): void`
  - `getOrigin(): Transform | null`
  - `setOrigin(t: Transform): void`
- **Verify:** Unit tests cover add/remove/update/resolve/serialize/deserialize round-trips with a multi-object snapshot.
- Depends: T-03.

### T-07 [F] Implement BoundaryGuard
- Create `src/scene/BoundaryGuard.ts` — no Three.js or IWSDK dependency.
  - `clampPosition(pos: [number,number,number], radiusM: number): [number,number,number]`
  - `clampScale(scale: number, min: number, max: number): number`
- **Verify:** Unit tests: position beyond radius is clamped to the boundary; scale below min is raised; scale above max is lowered.
- Depends: T-03.

### T-08 [F] Implement asset catalog TypeScript module
- Create `src/catalog/assetCatalog.ts` importing `assets.json`.
- Export `getAsset(id: string): AssetEntry | undefined` and `getAllIds(): string[]`.
- Typed `AssetEntry` interface matching the catalog schema.
- **Verify:** `getAsset("motorcycle_red")` returns the correct entry; `typecheck` passes.
- Depends: T-03, T-04.

### T-09 [F] Implement SceneEngine with placeholder cube
- Create `src/scene/SceneEngine.ts`.
  - Import Three.js from `@iwsdk/core` (never from `three` directly).
  - Internal `THREE.Group` as scene root, positioned at the confirmed surface origin.
  - `execute(actions: SceneAction[]): Promise<void>` — handles `add_object`, `move_object`, `remove_object`, `modify_object`.
  - For this task: all `add_object` actions place a `THREE.BoxGeometry` cube (placeholder; real loader added in T-20).
  - Updates `SceneState` after each action.
  - Emits `sceneChanged` event.
  - Expose `serialize()` and `deserialize()` delegating to `SceneState`.
- **Verify:** Calling `execute([{ action_type: "add_object", asset_id: "any", label: "test_cube", position: [0,0.05,0] }])` adds a visible cube to the Three.js scene and registers it in `SceneState`.
- Depends: T-06, T-07, T-08.

### T-10 [F] Implement DesktopInteractionAdapter
- Create `src/interaction/DesktopInteractionAdapter.ts` implementing `InteractionAdapter`.
- Input mapping per `design.md §3.3`:
  - First canvas click → `surfaceConfirmed` (origin at `[0,0,0]`)
  - Click on a scene object (Three.js raycaster) → `objectSelected`
  - Drag selected object → `objectMoved` (XZ plane projection)
  - Right-drag selected object → `objectRotated` (horizontal delta → Y rotation)
  - Scroll wheel on selected object → `objectScaled`
  - Mouse button release → `objectReleased`
- Uses a `THREE.Raycaster` against the scene objects registered in `SceneState`.
- **Verify:** In the desktop browser: clicking the canvas fires `surfaceConfirmed`; clicking a cube fires `objectSelected`; dragging moves it; scroll changes scale; release fires `objectReleased` with the final transform.
- Depends: T-05, T-09.

### T-11 [F] Wire adapter events to SceneEngine in main.ts
- In `src/index.ts` (IWSDK entry point):
  - Boot: detect XR support → instantiate `DesktopInteractionAdapter` (XR adapter will be added in T-25).
  - Subscribe to `InteractionAdapter.on(event => ...)`.
  - `surfaceConfirmed` → `SceneState.setOrigin`, position `SceneEngine` root, show `InputWidget`.
  - `objectMoved` → live-update the Three.js object position (preview, no SceneState write yet).
  - `objectReleased` → `BoundaryGuard.clamp` → `SceneState.update` → emit `objectTransformed`.
  - Other events wired similarly per `design.md §13`.
- **Verify:** Click canvas → origin locked. Place a cube via `SceneEngine.execute` directly in console → cube appears. Drag it → it moves. Release → position clamped and held.
- Depends: T-10.

### T-12 [F] Implement InputWidget (desktop-compatible)
- Create `src/ui/InputWidget.ts`.
  - Plain HTML `<div>` overlay (works in both desktop and XR DOM overlay modes).
  - Text input field + submit button; hidden until `surfaceConfirmed`.
  - On submit: disable input, show loading spinner, call `CommandClient.sendCommand` (stubbed for now — returns a hardcoded fixture response).
  - On response: call `SceneEngine.execute(actions)`, re-enable input.
  - On error: call `FeedbackOverlay.showError`.
- **Verify:** Desktop browser: input appears after canvas click; submitting with the stub returns a cube placed at `[0,0.05,0]`.
- Depends: T-11.

### T-13 [F] Implement FeedbackOverlay
- Create `src/ui/FeedbackOverlay.ts`.
  - `showLoading()` / `hideLoading()` — spinner overlay.
  - `showError(message: string)` — dismissable toast, 4-second auto-dismiss.
- Error messages per code per `design.md §10.2`.
- **Verify:** Manually calling `showLoading()` displays spinner; `showError("test")` shows toast that disappears after 4 seconds.
- Depends: T-03.

**End of Phase 1 — Desktop vertical slice complete.** Surface confirm, cube placement, mouse grab/move/rotate/scale, InputWidget, and FeedbackOverlay all work in a standard desktop browser. No Quest required.

---

## Phase 2 — Backend Foundation

### T-14 [B] Configure application settings
- Create `app/config.py` using `pydantic-settings`: `DATABASE_URL`, `GEMINI_API_KEY`, `ALLOWED_ORIGINS`, `SCENE_RADIUS_M` (default `0.5`), `SCENE_MAX_OBJECTS` (default `20`), `RATE_LIMIT_RPM` (default `10`).
- Create `.env.example` with placeholder values.
- **Verify:** Settings load from `.env`; missing required vars raise a clear error at startup.
- Depends: T-02.

### T-15 [B] Set up database and Alembic
- Create `app/models/db.py` with async SQLAlchemy engine, `Base`, `get_session` dependency.
- Initialize Alembic; configure `env.py` to read `DATABASE_URL` from settings.
- **Verify:** `alembic current` runs without error against a local PostgreSQL instance.
- Depends: T-14.

### T-16 [B] Create ORM models and initial migration
- Create `app/models/scene.py` and `app/models/scene_version.py` per `design.md §6`.
- Generate and apply: `alembic revision --autogenerate -m "create scenes and scene_versions"`.
- **Verify:** `alembic upgrade head` creates both tables and all indexes.
- Depends: T-15.

### T-17 [B] Create Pydantic schemas
- `app/schemas/scene.py`: `Transform`, `SceneObject`, `SceneSnapshot`.
- `app/schemas/command.py`: `CommandRequest` (`session_id` + `command_text` only — no snapshot), `CommandResponse`, `CommandError`.
- **Verify:** Valid payloads instantiate; invalid ones raise `ValidationError`.
- Depends: T-16.

### T-18 [B] Implement asset catalog loader
- `app/catalog/asset_catalog.py`: load `assets.json` at startup. Expose `get_all_ids()` and `lookup(asset_id)`.
- **Verify:** `lookup("motorcycle_red")` returns the correct entry; `lookup("unknown")` returns `None`.
- Depends: T-04, T-17.

### T-19 [B] Implement scene service, routers, validator, AI gateway, and middleware
This task builds the full backend stack in one coherent pass now that all models and schemas are in place.

**scene_service.py:**
- `get_scene(session_id, db) -> Scene | None`
- `apply_delta(session_id, snapshot, actions, command_text, db) -> Scene`
- `upsert_scene(session_id, snapshot, db) -> Scene`

**command_validator.py:**
- `validate(raw_json, asset_catalog) -> tuple[list[SceneAction], list[str]]`
- Exceptions: `ParseError`, `SchemaError`, `EmptyCommandError`

**ai_gateway.py:**
- `generate_command(command_text, scene_snapshot, asset_catalog, settings) -> str`
- Model: `gemini-3.8-flash`, `response_mime_type="application/json"`, `max_output_tokens=1024`. No `temperature`/`top_p`/`top_k`.
- One retry on 5xx; raise `GeminiUnavailableError` on second failure.

**routers/scenes.py:** `GET` and `PUT /api/v1/scenes/{session_id}`
**routers/commands.py:** `POST /api/v1/commands` — server-authoritative lifecycle per `design.md §4.2`.
**Middleware:** CORS (allowlist from settings), per-IP rate limit (10 req/min), HTML/JS strip on `command_text`.

- **Verify:**
  - `PUT` then `GET` round-trips a snapshot without data loss.
  - End-to-end test with mocked Gemini: `POST /api/v1/commands` returns `actions`; DB version incremented.
  - Request from unlisted origin → 403; 11th rapid request → 429.
- Depends: T-17, T-18.

---

## Phase 3 — Frontend AI Integration

### T-20 [F] Implement AssetLoader (real GLB loading)
- Create `src/scene/AssetLoader.ts`.
- `load(assetId: string): Promise<Object3D>` — validates against catalog, loads GLB via IWSDK asset manifest (not raw `GLTFLoader`), caches by `assetId`.
- Throws `UnknownAssetError` for IDs absent from catalog.
- Register assets in `src/assets.ts` per the IWSDK asset manifest contract.
- **Verify:** Valid `asset_id` loads and returns an `Object3D`; invalid ID throws `UnknownAssetError`.
- Depends: T-08, T-09.

### T-21 [F] Replace cube placeholder in SceneEngine
- Update `SceneEngine.ts` to call `AssetLoader.load(asset_id)` instead of `BoxGeometry`.
- On `UnknownAssetError`: skip the action, log a warning, continue with remaining actions.
- **Verify:** `execute` with `asset_id: "fountain_stone"` loads and renders the GLB.
- Depends: T-20.

### T-22 [F] Implement CommandClient
- Create `src/ai/CommandClient.ts`.
- `sendCommand(commandText: string): Promise<CommandResponse>` — `POST /api/v1/commands` with `{ session_id, command_text }`.
- One retry on HTTP 5xx; throws `CommandError` on second failure.
- Remove the stub from `InputWidget` and wire to the real client.
- **Verify:** Unit test: success → `CommandResponse`; 5xx → retry; second 5xx → `CommandError`.
- Depends: T-03, T-12.

### T-23 [F] Implement PersistenceClient
- Create `src/persistence/PersistenceClient.ts`.
- `save(sessionId, snapshot): Promise<void>` → `PUT /api/v1/scenes/{sessionId}`.
- `load(sessionId): Promise<SceneSnapshot | null>` → `GET`; returns `null` on 404.
- `session_id` managed in `localStorage` (UUID v4 on first run).
- **Verify:** `save` then `load` returns the same snapshot via the running backend.
- Depends: T-03, T-19.

### T-24 [F] Wire persistence and session restore
- After each `SceneEngine` `sceneChanged` event: call `PersistenceClient.save`.
- After each `objectTransformed` event: call `PersistenceClient.save`.
- On app boot: `PersistenceClient.load` → if snapshot exists, `SceneEngine.deserialize`.
- **Verify:** Place objects, refresh page, objects reappear at correct positions. DB `version` increments after each mutation.
- Depends: T-21, T-22, T-23.

---

## Phase 4 — XR Adapter

### T-25 [F] Implement XRInteractionAdapter
- Create `src/interaction/XRInteractionAdapter.ts` implementing `InteractionAdapter`.
- Instantiates and registers IWSDK ECS systems: `PlacementSystem` (new), uses built-in `EnvironmentRaycastSystem`, `HandInputSystem`, `OneHandGrabbable`, `TwoHandsGrabbable`.
- Maps IWSDK events to `InteractionEvent` objects per `design.md §3.4`.
- **Verify:** On device: surface confirm fires `surfaceConfirmed`; grabbing a cube fires `objectMoved`/`objectReleased` with correct transforms.
- Depends: T-11.

### T-26 [F] Implement PlacementSystem (XR)
- Create `src/systems/PlacementSystem.ts` (ECS system, registered by `XRInteractionAdapter`).
- Subscribe to `EnvironmentRaycastSystem` hit events; filter for upward-facing normals (horizontal surfaces).
- Show/update reticle mesh at hit point each frame.
- On `HandInputSystem` pinch confirm: emit `surfaceConfirmed` via the adapter, change reticle to confirmed state, unsubscribe.
- **Verify:** On device with a table, reticle tracks the surface; pinch confirms and freezes reticle.
- Depends: T-25.

### T-27 [F] Update main.ts for runtime mode selection
- Update `src/index.ts` boot sequence:
  ```
  if (XR supported) → XRInteractionAdapter
  else              → DesktopInteractionAdapter
  ```
- No business logic changes — the downstream event handler in T-11 is already adapter-agnostic.
- **Verify:** On desktop: `DesktopInteractionAdapter` active, full flow works. On Quest: `XRInteractionAdapter` active, full flow works. No code path is duplicated.
- Depends: T-24, T-26.

---

## Phase 5 — Validation Pass and Hardening

### T-28 [B] End-to-end backend test with real Gemini
- With backend running and real `GEMINI_API_KEY`:
  - `POST /api/v1/commands { session_id, command_text: "Create a small Japanese market with two stalls and a fountain." }`
  - Confirm response contains ≥ 1 `add_object` action with a valid `asset_id`.
  - Confirm DB snapshot updated.
- **Verify:** AC-03, AC-04, AC-08, AC-09 from `requirements.md` pass.
- Depends: T-19.

### T-29 [F][B] Full acceptance-criteria sweep
- Desktop: run through the complete user flow, check AC-01 to AC-10 adapted for desktop mode.
- On Meta Quest 3: run the full XR user flow from `requirements.md §1`, check all AC.
- Document any failing criteria as follow-up fix tasks before closing.
- Depends: T-27, T-28.

### T-30 [S] Finalize `.env.example` and developer README
- `.env.example`: every required env var with safe placeholder values.
- `README.md`: local PostgreSQL setup, backend startup, frontend dev server, desktop testing workflow, Quest connection over LAN, minimal cloud deployment notes.
- **Verify:** A developer following only the README can run the full desktop stack locally without additional guidance.
- Depends: T-29.

---

## Task Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 0 — Scaffolding | T-01 – T-04 | Repo, tooling, shared artifacts |
| 1 — Desktop Slice | T-05 – T-13 | InteractionAdapter, SceneEngine, desktop grab/move, InputWidget |
| 2 — Backend | T-14 – T-19 | API, DB, Gemini, validation |
| 3 — Frontend AI | T-20 – T-24 | Real assets, CommandClient, persistence, session restore |
| 4 — XR Adapter | T-25 – T-27 | XRInteractionAdapter, PlacementSystem, mode selection |
| 5 — Hardening | T-28 – T-30 | Real Gemini test, AC sweep, docs |

**Total: 30 tasks**

Critical path:
```
T-01 → T-03 → T-05 → T-06 → T-09 → T-10 → T-11 → T-12   (desktop slice)
     → T-02 → T-14 → T-15 → T-16 → T-17 → T-18 → T-19   (backend)
T-21 → T-22 → T-24 → T-25 → T-26 → T-27 → T-28 → T-29 → T-30
```
