# WorldCraft AI — Technical Design

## 1. System Overview

WorldCraft AI is a mixed-reality WebXR application running on Meta Quest. The user places a virtual 3D market scene on a physical table and interacts with it using bare hands. Natural-language commands are translated into structured scene mutations by a FastAPI backend that calls the Gemini API. The client never interprets free-form AI output directly; a deterministic Scene Engine is the only component that mutates the 3D scene.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (any platform)                   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               InteractionAdapter (interface)             │  │
│  │                                                          │  │
│  │   DesktopInteractionAdapter    XRInteractionAdapter      │  │
│  │   (mouse / touch / keyboard)   (IWSDK ECS + hands)       │  │
│  └───────────────────────┬──────────────────────────────────┘  │
│                          │ InteractionEvents                    │
│                          │ (select, grab, move, rotate,        │
│                          │  scale, release, surfaceConfirmed)  │
│  ┌───────────────────────▼──────────────────────────────────┐  │
│  │          Platform-independent business layer             │  │
│  │                                                          │  │
│  │   SceneEngine    SceneState    BoundaryGuard             │  │
│  │   AssetLoader    CommandClient PersistenceClient         │  │
│  │   InputWidget    FeedbackOverlay                         │  │
│  └───────────────────────┬──────────────────────────────────┘  │
└──────────────────────────│──────────────────────────────────────┘
                           │ HTTPS
                ┌──────────▼──────────┐
                │    FastAPI Backend  │
                │  AI Gateway         │
                │  Validator          │
                │  Scene Service      │
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │     PostgreSQL      │
                └─────────────────────┘
```

**Core architectural principles:**
> Gemini decides *intent and parameters*. The Scene Engine decides *what can actually happen*.
> The `InteractionAdapter` is the only platform-specific code. Everything below it is runtime-agnostic.

---

## 2. Runtime Modes

WorldCraft AI supports two runtime modes selected automatically at boot:

| Mode | Trigger | Input source | Primary use |
|------|---------|-------------|-------------|
| **Desktop** | No WebXR `immersive-ar` support detected | Mouse drag = move, scroll = scale, right-drag = rotate, click = select/confirm | Development, testing, demo on any machine |
| **XR** | WebXR `immersive-ar` + `hand-tracking` available (Meta Quest) | IWSDK ECS: `EnvironmentRaycastSystem`, `HandInputSystem`, `OneHandGrabbable` / `TwoHandsGrabbable` | Production MR experience |

**Selection logic in `main.ts`:**
```
if (navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')) {
  adapter = new XRInteractionAdapter(world)
} else {
  adapter = new DesktopInteractionAdapter(renderer, camera)
}
```

Both adapters implement the same `InteractionAdapter` interface and emit identical `InteractionEvent` objects. All downstream code is unaware of which adapter is active.

---

## 3. Frontend Architecture

### 3.1 Module Map

```
src/
├── interaction/
│   ├── InteractionAdapter.ts       — Interface + InteractionEvent types
│   ├── DesktopInteractionAdapter.ts — Mouse/touch/keyboard implementation
│   └── XRInteractionAdapter.ts     — IWSDK ECS implementation
├── systems/                        — IWSDK ECS systems (XR mode only, registered by XRInteractionAdapter)
│   └── PlacementSystem.ts          — EnvironmentRaycastSystem listener; surface confirm
├── scene/
│   ├── SceneEngine.ts              — THREE.Scene owner; executes validated SceneCommands
│   ├── SceneState.ts               — In-memory object registry (id → SceneObject); pure data
│   ├── AssetLoader.ts              — glTF/GLB loader; validates asset IDs against catalog
│   └── BoundaryGuard.ts            — Enforces placement radius and scale limits
├── ai/
│   └── CommandClient.ts            — HTTP client; sends commands, receives SceneCommandResponse
├── ui/
│   ├── InputWidget.ts              — Text input (DOM; works in both modes)
│   └── FeedbackOverlay.ts          — Loading spinner, error toast, confirmation prompt
├── persistence/
│   └── PersistenceClient.ts        — HTTP client for scene save/load endpoints
├── catalog/
│   └── assetCatalog.ts             — Typed import of assets.json; lookup helpers
└── main.ts                         — Boot: mode detection, adapter init, system wiring
```

### 3.2 InteractionAdapter Interface

```typescript
// All events emitted by both adapters — downstream code handles only these.
type InteractionEvent =
  | { type: 'surfaceConfirmed'; origin: Transform }
  | { type: 'objectSelected';   objectId: string }
  | { type: 'objectMoved';      objectId: string; position: Vec3 }
  | { type: 'objectRotated';    objectId: string; rotationY: number }
  | { type: 'objectScaled';     objectId: string; scale: number }
  | { type: 'objectReleased';   objectId: string; transform: Transform };

interface InteractionAdapter {
  /** Called once per frame by the render loop. */
  update(delta: number): void;
  /** Subscribe to interaction events. Returns unsubscribe function. */
  on(handler: (event: InteractionEvent) => void): () => void;
  /** Clean up all resources. */
  dispose(): void;
}
```

Neither `SceneEngine` nor any other business module imports from `interaction/`. They only consume `InteractionEvent` objects via the event bus in `main.ts`.

### 3.3 DesktopInteractionAdapter

Input mapping:

| User action | InteractionEvent emitted |
|------------|--------------------------|
| Click on canvas | `surfaceConfirmed` (first click sets origin at world origin) |
| Click on object | `objectSelected` |
| Drag selected object | `objectMoved` (mouse XZ projected onto scene plane) |
| Right-drag selected object | `objectRotated` (horizontal drag = Y rotation delta) |
| Scroll wheel on selected object | `objectScaled` |
| Release mouse button | `objectReleased` |

The surface confirmation on desktop is immediate on first canvas click — no raycast needed. The scene origin is fixed at `[0, 0, 0]` in world space for desktop mode.

### 3.4 XRInteractionAdapter

Wraps IWSDK ECS systems. Registered only when XR mode is active.

| IWSDK component / system | Maps to |
|---|---|
| `EnvironmentRaycastSystem` hit + `HandInputSystem` pinch | `surfaceConfirmed` |
| `HandInputSystem` pinch on object | `objectSelected` |
| `OneHandGrabbable` move | `objectMoved` |
| `OneHandGrabbable` rotate | `objectRotated` |
| `TwoHandsGrabbable` scale | `objectScaled` |
| `OneHandGrabbable` / `TwoHandsGrabbable` release | `objectReleased` |

`PlacementSystem` (ECS custom system) lives here — it is instantiated and registered by `XRInteractionAdapter`, not by `main.ts` directly.

### 3.5 Rendering Stack

| Concern | Desktop mode | XR mode |
|---------|-------------|---------|
| Renderer | `THREE.WebGLRenderer` (manual) | `World.create()` owns the renderer |
| Session | Standard browser canvas | `immersive-ar` + `hand-tracking` |
| Surface detection | Fixed origin at `[0,0,0]` | `EnvironmentRaycastSystem` |
| Grabbing | Mouse drag events | IWSDK `OneHandGrabbable` / `TwoHandsGrabbable` |
| Asset format | glTF 2.0 / GLB | glTF 2.0 / GLB |
| UI | DOM overlay (HTML div, always visible) | WebXR DOM Overlay API |

**Important:** `@iwsdk/core` re-exports all of Three.js. Import Three from `@iwsdk/core`, never from `three` directly, to avoid duplicate module instances. This applies in both modes.

### 3.6 SceneEngine

The Scene Engine is the single point of truth for the 3D scene. It is completely platform-independent — it knows nothing about IWSDK, WebXR, or mouse events.

Responsibilities:
- Maintain a `SceneState` registry: `Map<ObjectId, SceneObject>`.
- Execute `add_object`, `move_object`, `remove_object`, `modify_object` actions from validated `SceneCommand` objects.
- Delegate asset loading to `AssetLoader` (catalog-validated).
- Delegate transform clamping to `BoundaryGuard`.
- Emit `sceneChanged` after every mutation.
- Expose `serialize(): SceneSnapshot` and `deserialize(snapshot: SceneSnapshot)`.

The Scene Engine does **not** call the network, parse AI responses, know about Gemini, or import from `interaction/`.

### 3.7 BoundaryGuard

Called from `main.ts` when an `objectReleased` event arrives — after either adapter fires it.

- `clampPosition(pos: Vec3, radiusM: number): Vec3`
- `clampScale(scale: number, min: number, max: number): number`

Platform-independent. No IWSDK or DOM imports.

### 3.8 CommandClient

- `POST /api/v1/commands` with `{ session_id, command_text }` — no snapshot.
- The server is the authority on current scene state.
- One retry on HTTP 5xx.
- Platform-independent.

---

## 4. Backend Architecture

### 4.1 Module Map

```
app/
├── main.py                   — FastAPI app factory, router registration, CORS config
├── routers/
│   ├── commands.py           — POST /api/v1/commands
│   └── scenes.py             — GET/PUT /api/v1/scenes/{session_id}
├── services/
│   ├── ai_gateway.py         — Gemini API client; prompt building; raw response parsing
│   ├── command_validator.py  — JSON Schema validation of Gemini output
│   └── scene_service.py      — Scene CRUD; delta merging; state hydration
├── models/
│   ├── db.py                 — SQLAlchemy Base, engine, session factory
│   ├── scene.py              — Scene ORM model
│   └── scene_version.py      — SceneVersion ORM model (lightweight history)
├── schemas/
│   ├── command.py            — Pydantic: CommandRequest, CommandResponse, CommandError
│   └── scene.py              — Pydantic: SceneSnapshot, SceneObject, Transform
├── catalog/
│   └── asset_catalog.py      — Loads assets.json; exposes lookup and validation helpers
├── config.py                 — Settings (env vars via pydantic-settings)
└── scene_command_schema.json — Canonical JSON Schema for SceneCommand (shared with client)
```

### 4.2 Request Lifecycle — POST /api/v1/commands

The server is the authority on scene state for AI commands. The client sends only `session_id` and `command_text`.

```
Client
  │
  ├─▶ POST /api/v1/commands  { session_id, command_text }
  │
  ▼
FastAPI router (commands.py)
  │
  ├─▶ Validate request body (Pydantic)
  │
  ├─▶ scene_service.get_scene(session_id)
  │       └─ Load current SceneSnapshot from DB (or empty if first command)
  │
  ├─▶ ai_gateway.generate_command(command_text, scene_snapshot, asset_catalog)
  │       └─ Gemini API call → raw_json_string
  │
  ├─▶ command_validator.validate(raw_json_string)
  │       ├─ JSON parse error    → CommandError(code="AI_PARSE_ERROR")
  │       ├─ Schema violation    → CommandError(code="AI_SCHEMA_ERROR")
  │       └─ Unknown asset IDs   → filter out unknown actions, log warning
  │
  ├─▶ scene_service.apply_delta(session_id, current_snapshot, validated_actions)
  │       └─ Merge delta, persist new SceneSnapshot to DB
  │
  └─▶ Return SceneCommandResponse { actions: [...], warnings: [...] }
```

### 4.3 Gemini Integration (ai_gateway.py)

**Prompt structure:**

```
SYSTEM (static):
  You are the WorldCraft AI scene director.
  Your only job is to return a JSON object that conforms exactly to the
  WorldCraft Scene Command Schema provided below. Do not explain. Do not
  add prose. Return only the JSON object.

  Asset Catalog (exhaustive list of valid asset IDs):
  <serialized asset catalog — id + tags only>

  Scene Command Schema:
  <serialized scene_command_schema.json>

USER:
  Current scene state:
  <compact object list: id, label, asset_id, position — or "empty">

  User command:
  "<command_text>"
```

**Model configuration:**
- Model: `gemini-3.1-flash-lite`
- `response_mime_type: "application/json"` (structured output — response is valid JSON, no fence stripping needed)
- `max_output_tokens: 1024`
- No `temperature`, `top_p`, or `top_k` — not supported on Gemini 3.x.
- One retry on Gemini 5xx; raise `GeminiUnavailableError` on second failure.

---

## 5. API Boundaries

### 5.1 Endpoints

#### `POST /api/v1/commands`
Request: `{ session_id: uuid, command_text: string (max 500) }`
Response 200: `{ actions: SceneAction[], warnings: string[] }`
Errors: 400 `AI_PARSE_ERROR` · 400 `AI_SCHEMA_ERROR` · 400 `COMMAND_EMPTY` · 503 `AI_UNAVAILABLE` · 422 `INVALID_REQUEST`

#### `GET /api/v1/scenes/{session_id}`
Returns latest `SceneSnapshot` or 404 `SESSION_NOT_FOUND`.

#### `PUT /api/v1/scenes/{session_id}`
Request: `{ snapshot: SceneSnapshot }` — persists hand-interaction state.
Response 200: updated scene record.

### 5.2 Error Codes

| Code | Meaning |
|------|---------|
| `AI_PARSE_ERROR` | Gemini response could not be parsed as JSON |
| `AI_SCHEMA_ERROR` | Gemini JSON does not conform to Scene Command Schema |
| `AI_UNAVAILABLE` | Gemini API returned 5xx after one retry |
| `COMMAND_EMPTY` | No valid actions remained after catalog filtering |
| `SESSION_NOT_FOUND` | No scene state exists for the given session_id |
| `INVALID_REQUEST` | Request body failed Pydantic validation |
| `PERSISTENCE_ERROR` | DB write failed |

---

## 6. Database Model

### 6.1 `scenes` table

```sql
CREATE TABLE scenes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL UNIQUE,
    version     INTEGER NOT NULL DEFAULT 1,
    snapshot    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scenes_session_id ON scenes(session_id);
```

### 6.2 `scene_versions` table

```sql
CREATE TABLE scene_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id    UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    snapshot    JSONB NOT NULL,
    command     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (scene_id, version)
);
CREATE INDEX idx_scene_versions_scene_id ON scene_versions(scene_id);
```

Both paths (AI command + hand interaction) increment `version` and append a `scene_versions` row. `scene_versions` is append-only for MVP.

---

## 7. Scene Model and Asset Model

### 7.1 SceneObject

```typescript
interface Transform {
  position: [number, number, number];         // meters, relative to scene origin
  rotation: [number, number, number, number]; // quaternion [x, y, z, w]
  scale:    [number, number, number];
}

interface SceneObject {
  id:       string;   // stable UUID assigned at placement time
  asset_id: string;   // must exist in asset catalog
  label:    string;   // used for AI target resolution
  transform: Transform;
}

interface SceneSnapshot {
  version: number;
  objects: SceneObject[];
  origin:  Transform;  // confirmed surface position/orientation in world space
}
```

### 7.2 Asset Catalog (assets.json)

```json
{
  "version": "1.0.0",
  "assets": [
    {
      "id": "market_stall_japanese",
      "label": "Japanese Market Stall",
      "glb_path": "/assets/models/market_stall_japanese.glb",
      "category": "structure",
      "default_scale": [1.0, 1.0, 1.0],
      "min_scale": 0.3, "max_scale": 2.0,
      "pivot": "base_center",
      "tags": ["stall", "market", "japanese", "shop"]
    },
    {
      "id": "fountain_stone",
      "label": "Stone Fountain",
      "glb_path": "/assets/models/fountain_stone.glb",
      "category": "prop",
      "default_scale": [1.0, 1.0, 1.0],
      "min_scale": 0.2, "max_scale": 1.5,
      "pivot": "base_center",
      "tags": ["fountain", "water", "decoration"]
    },
    {
      "id": "motorcycle_red",
      "label": "Red Motorcycle",
      "glb_path": "/assets/models/motorcycle_red.glb",
      "category": "vehicle",
      "default_scale": [1.0, 1.0, 1.0],
      "min_scale": 0.3, "max_scale": 1.5,
      "pivot": "base_center",
      "tags": ["motorcycle", "bike", "vehicle", "red"]
    }
  ]
}
```

### 7.3 Boundary Rules (BoundaryGuard)

| Rule | Default | Configurable via |
|------|---------|-----------------|
| Maximum placement radius | 0.5 m | `SCENE_RADIUS_M` env var |
| Per-asset min/max scale | from catalog | `assets.json` |
| Maximum objects per scene | 20 | `SCENE_MAX_OBJECTS` env var |

---

## 8. Gemini Scene Command JSON Schema

`scene_command_schema.json` — strict contract, `additionalProperties: false` everywhere.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SceneCommand",
  "type": "object",
  "required": ["actions"],
  "additionalProperties": false,
  "properties": {
    "actions": { "type": "array", "minItems": 1, "maxItems": 20,
                 "items": { "$ref": "#/$defs/SceneAction" } }
  },
  "$defs": {
    "SceneAction": {
      "oneOf": [
        { "$ref": "#/$defs/AddObject" }, { "$ref": "#/$defs/MoveObject" },
        { "$ref": "#/$defs/RemoveObject" }, { "$ref": "#/$defs/ModifyObject" }
      ]
    },
    "AddObject": {
      "type": "object", "required": ["action_type","asset_id","label","position"],
      "additionalProperties": false,
      "properties": {
        "action_type": { "type": "string", "const": "add_object" },
        "asset_id":    { "type": "string" },
        "label":       { "type": "string", "maxLength": 64 },
        "position":    { "$ref": "#/$defs/Vec3" },
        "rotation_y":  { "type": "number" },
        "scale":       { "type": "number", "minimum": 0.1, "maximum": 10.0 }
      }
    },
    "MoveObject": {
      "type": "object", "required": ["action_type","target_label","position"],
      "additionalProperties": false,
      "properties": {
        "action_type":  { "type": "string", "const": "move_object" },
        "target_label": { "type": "string" },
        "position":     { "$ref": "#/$defs/Vec3" },
        "rotation_y":   { "type": "number" }
      }
    },
    "RemoveObject": {
      "type": "object", "required": ["action_type","target_label"],
      "additionalProperties": false,
      "properties": {
        "action_type":  { "type": "string", "const": "remove_object" },
        "target_label": { "type": "string" }
      }
    },
    "ModifyObject": {
      "type": "object", "required": ["action_type","target_label"],
      "additionalProperties": false,
      "properties": {
        "action_type":  { "type": "string", "const": "modify_object" },
        "target_label": { "type": "string" },
        "scale":        { "type": "number", "minimum": 0.1, "maximum": 10.0 }
      }
    },
    "Vec3": { "type": "array", "items": { "type": "number" }, "minItems": 3, "maxItems": 3 }
  }
}
```

Target resolution for `move_object` / `remove_object` / `modify_object`: case-insensitive match on `SceneObject.label` against the DB snapshot. No match → action skipped, warning added.

---

## 9. Validation Strategy

| Layer | What | Tool |
|-------|------|------|
| Client request | Request body shape | Pydantic |
| AI output — parse | Valid JSON | `json.loads` |
| AI output — schema | Schema conformance | `jsonschema` |
| Asset IDs | Exist in catalog | `asset_catalog.lookup` |
| Target labels | Resolve in DB snapshot | `scene_service` |
| Transforms | Bounds + scale limits | `BoundaryGuard` (client) |

Filtering policy: parse/schema failure → reject all. Unknown `asset_id` or unresolvable `target_label` → filter that action, continue. All filtered → `COMMAND_EMPTY`.

---

## 10. Error Handling

### 10.1 Backend

| Scenario | HTTP | Code |
|----------|------|------|
| Pydantic fail | 422 | `INVALID_REQUEST` |
| Gemini parse error | 400 | `AI_PARSE_ERROR` |
| Gemini schema error | 400 | `AI_SCHEMA_ERROR` |
| All filtered | 400 | `COMMAND_EMPTY` |
| Gemini 5xx (after retry) | 503 | `AI_UNAVAILABLE` |
| DB write fail | 500 | `PERSISTENCE_ERROR` |
| Session not found | 404 | `SESSION_NOT_FOUND` |

### 10.2 Client

- `AI_PARSE_ERROR` / `AI_SCHEMA_ERROR` / `COMMAND_EMPTY` → toast "Couldn't understand that. Try rephrasing."
- `AI_UNAVAILABLE` → toast "AI unavailable." + retry button
- `PERSISTENCE_ERROR` → silent log; scene stays live in memory
- Network timeout → treated as `AI_UNAVAILABLE`

---

## 11. Security Boundaries

| Boundary | Mechanism |
|----------|-----------|
| API key | `GEMINI_API_KEY` server-side env only |
| Transport | HTTPS; HTTP rejected in production |
| Input sanitation | `command_text` stripped of HTML/JS; max 500 chars |
| Prompt injection | Fixed SYSTEM block; user text in delimited USER block |
| Schema enforcement | `additionalProperties: false` everywhere; client never acts on unvalidated output |
| Scene state authority | Server loads from DB for AI path; client cannot supply snapshot in command |
| Session isolation | `session_id` UUID; server never returns another session's data |
| CORS | Explicit origin allowlist; no wildcard in production |
| Rate limiting | 10 req/min per IP on `POST /api/v1/commands` |

---

## 12. Persistence Flow

**AI command path (server authoritative):**
```
POST /api/v1/commands { session_id, command_text }
  → scene_service.get_scene()        — load snapshot from DB
  → ai_gateway.generate_command()    — call Gemini
  → command_validator.validate()     — schema + catalog check
  → scene_service.apply_delta()      — upsert scenes, insert scene_versions
  → return { actions, warnings }
  → client executes actions on Three.js (visual only — DB already updated)
```

**Interaction path (client authoritative for spatial state):**
```
InteractionAdapter fires objectReleased
  → BoundaryGuard.clamp()
  → SceneState.update()
  → PersistenceClient → PUT /api/v1/scenes/{session_id}
  → scene_service.upsert() — version++
```

**Session restore:**
```
boot → PersistenceClient.load() → SceneEngine.deserialize(snapshot)
```

---

## 13. Interaction Flow

```
Render loop (per frame)
  │
  ├─▶ InteractionAdapter.update(delta)
  │       ├─ Desktop: poll mouse/keyboard state → emit InteractionEvents
  │       └─ XR: poll IWSDK ECS systems → emit InteractionEvents
  │
  ├─▶ main.ts event handler
  │       ├─ surfaceConfirmed  → SceneState.setOrigin, show InputWidget
  │       ├─ objectMoved       → SceneEngine.previewMove (live visual)
  │       ├─ objectReleased    → BoundaryGuard.clamp → SceneState.update
  │       │                   → PersistenceClient.save
  │       └─ (other events handled similarly)
  │
  └─▶ Three.js render()
```

---

## 14. Responsibilities by Module

| Module | Owns | Does NOT own |
|--------|------|-------------|
| `DesktopInteractionAdapter` | Mouse/keyboard → InteractionEvents | Scene graph, business logic |
| `XRInteractionAdapter` | IWSDK ECS → InteractionEvents | Scene graph, business logic |
| `PlacementSystem` | Surface confirm in XR mode | Desktop path, scene graph |
| `SceneEngine` | THREE.Scene mutations, object registry | Input, networking, AI |
| `SceneState` | In-memory object registry | Rendering, networking |
| `AssetLoader` | glTF loading, catalog validation | Transform logic |
| `BoundaryGuard` | Transform clamping | Rendering, persistence, input |
| `CommandClient` | HTTP POST to /commands | Scene state, snapshot |
| `PersistenceClient` | HTTP PUT/GET scene state | Scene logic |
| `InputWidget` | Text input UI | Command routing |
| `ai_gateway.py` | Gemini API call, prompt assembly | Validation |
| `command_validator.py` | JSON Schema validation, catalog filter | Persistence, routing |
| `scene_service.py` | DB upsert, delta merge, version bump, state authority | AI calls, routing |
| `asset_catalog.py` | Catalog loading, ID lookup | Scene graph |

---

## 15. First Vertical Slice

Before Gemini, PostgreSQL, or XR hardware are involved, the first working deliverable is:

> **Desktop browser → click canvas to confirm surface → type a command → cube appears → mouse-drag moves it.**

This validates:
- `DesktopInteractionAdapter` surface confirm + grab/move
- `SceneEngine` with placeholder cube asset
- `BoundaryGuard` clamping
- `InputWidget` text input
- `CommandClient` → backend → `SceneEngine.execute` round-trip

XR mode (`XRInteractionAdapter` + IWSDK) is the second slice, layered on top of the same business logic.
