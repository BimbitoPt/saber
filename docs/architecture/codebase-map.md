# Saber codebase map

Rendered with Mermaid (`flowchart TB`). Red nodes are the known-worst parts from the 2026-10-12 audit; each has evidence in the audit notes below the diagram.

```mermaid
flowchart TB

%% ================= RUST SHELL =================
subgraph RUST["Tauri v2 shell — src-tauri/src (Rust)"]
  direction TB
  MAIN["main.rs start_server<br/>spawns bun run dev --port 8082 --strictPort<br/>readiness = scrape stdout for a text line<br/>stderr copied into sink - errors lost<br/>spawn once - nothing supervises after boot"]
  RT["runtime.rs<br/>hand-rolled HTTP client ~140 LOC<br/>chunked decoding written twice<br/>status check: line contains ' 200 '"]
  PTYR["terminal.rs<br/>Mutex of HashMap sessions<br/>N terminals = N PTYs + N OS threads<br/>8KB reads via from_utf8_lossy - splits multibyte chars<br/>reader thread never removes session on exit"]
  WEB["Webview window built in code<br/>points at http://127.0.0.1:8082/<br/>CSP null, withGlobalTauri"]
  MAIN -->|"readiness: stdout scrape, then TCP GET /api/v1/health"| WEB
end

%% ================= FRONTEND =================
subgraph FE["Frontend — TanStack Start SSR + React 19"]
  direction TB
  ROOT["__root.tsx, route / index.tsx<br/>tabs are useState, panel state never in URL<br/>inactive panels stay MOUNTED - timers keep firing"]
  TW["TaskWorkspace 17KB<br/>owns tasks array wholesale-replaced every 2s<br/>owns terminal sessions + never-pruned start Set"]
  TD["TaskDetail 13KB<br/>separate 1.5s poll of runs<br/>form is a one-time snapshot - Save overwrites concurrent edits"]
  TSURF["TerminalSurface + xterm<br/>dynamic import, FitAddon, ResizeObserver<br/>manual session mirror in ref + callback"]
  PANES["Other panes<br/>DevServerPane 2s, BrowserPane 2.5s, SessionPane 60ms long-poll<br/>7 components copy-paste the busy/error triple<br/>SessionPane re-JSON.parses 300 lines every render"]
  LIB["lib/api.ts jsonFetch + long-poll<br/>lib/tasks.ts field helpers<br/>BrowserPane bypasses jsonFetch, ignores res.ok"]
  ROOT --> TW
  TW --> TD
  TW --> TSURF
  TW --> PANES
  TW --> LIB
end

%% ================= SERVER =================
subgraph SRV["Bun server — src/server.ts 28KB + src/server/"]
  direction TB
  ENTRY["fetch entry server.ts:61<br/>/api/v1 to handleApiV1, /api to handleApi, else SSR"]
  V1["apiV1.ts - read-only, loopback + bearer<br/>pagination block copy-pasted 4x<br/>route allow-list re-declared as regexes<br/>openapi.ts keeps a 3rd copy of the contract"]
  GOD["handleApi god router ~470 LOC, ~35 endpoints<br/>error status decided by REGEX ON MESSAGE TEXT<br/>validation blocks copy-pasted"]
  LOCKS["terminalLocks.ts<br/>in-memory Map plus SQLite rows = 2 truths<br/>hydrate() silently resurrects rows<br/>conflict check copy-pasted from taskStore"]
  TS["taskStore.ts 22KB god store<br/>every column is data TEXT JSON - N+1 reads<br/>constructor marks OTHER processes runs interrupted<br/>appendEvent reads outside BEGIN IMMEDIATE"]
  GIT["gitWorkspaces.ts 14KB<br/>4 twin lifecycle pairs copy-pasted<br/>execFileSync 15s timeout fires 3-4x per launch<br/>branch names inconsistent across twins"]
  DEV["devServers.ts<br/>USERPROFILE hardcoded bun.exe path<br/>no exit handler - dead server stays starting<br/>taskkill only, port probe never binds the OS"]
  BRW["browser.ts singleton chromium<br/>partial launch leaks a second instance<br/>no disconnect reset, shutdown() has zero callers"]
  PROV["providers/ + agentRuns + events.ts<br/>any-typed if-chain, unknown event types vanish<br/>provider_error not marked failed<br/>every output line stored twice - raw + parsed"]
  ONYX["onyxContext.ts - fail-soft HTTP to Onyx"]
  DEAD["sessionStore.ts - DEAD CODE, zero references"]
  ENTRY --> V1
  ENTRY --> GOD
  GOD --> LOCKS
  GOD --> TS
  GOD --> GIT
  GOD --> DEV
  GOD --> BRW
  GOD --> PROV
  GOD --> ONYX
end

%% ================= STORAGE =================
subgraph STORE["State and storage"]
  SQ["tasks.sqlite WAL, SABER_DATA_DIR or ~/.saber<br/>globalThis.saberTaskStore singleton<br/>tasks, runs, verifications, events, terminal_sessions<br/>hot fields buried in JSON blobs"]
  WT["worktrees/ root<br/>task tree codex/saber-taskId<br/>run tree saber/id8/run8"]
  TOK["~/.saber/api-token file"]
  PRJ["projects.json pinned to Desktop mstudio-os"]
  LS["localStorage mirrors<br/>saber.task.*, saber.selectedTask, saber.provider.*"]
  TS --> SQ
  LOCKS --> SQ
  V1 --> TOK
  GOD --> PRJ
  TW --> LS
end

%% ================= EXTERNAL =================
subgraph EXT["External processes"]
  CLIS["provider CLIs on PATH<br/>opencode, codex, claude<br/>spawned stdio: ignore, pipe, pipe"]
  OX["Onyx :8083"]
  DS["dev servers :809x<br/>bun run dev --strictPort"]
  CH["headless chromium 1280x800"]
end

%% ================= CROSS-BOUNDARY FLOWS =================
TSURF <-->|"invoke terminal_start/write/resize/close<br/>events terminal-output:id, terminal-exited:id"| PTYR
MAIN -->|"bun run dev / bundled node + server/index.mjs"| ENTRY
PANES -->|"long-poll GET /api/sessions/:id/events?wait=1"| ENTRY
TW -->|"2s GET /api/tasks"| ENTRY
TD -->|"1.5s GET /api/tasks/:id/runs"| ENTRY
LIB --> ENTRY
PROV -.->|spawn provider process| CLIS
DEV -.->|spawn USERPROFILE bun path| DS
BRW -.-> CH
ONYX -.-> OX
WEB -.-> FE

%% ================= STYLING =================
classDef bad fill:#3a1a22,stroke:#ff6b81,stroke-width:1px,color:#ffd9de;
classDef good fill:#13231d,stroke:#4ee6a8,color:#d9fff0;
class MAIN,RT,PTYR,GOD,LOCKS,TS,GIT,DEV,BRW,PROV,DEAD,TW,TD,PANES,PRJ bad;
class LIB,TOK,SQ,V1 good;
```

## Legend

- Red nodes: worst parts found in the 2026-10-12 audit, with the specific defect written into the node.
- Green nodes: layers that hold up (v1 API contract, token auth, SQLite WAL store itself, client fetch helper).
- Solid arrows: request/data flow. Dashed arrows: process spawns and side-channel boundaries.

## Audit notes: the five root diseases

Every red node traces to one of five patterns:

1. **Copy-paste instead of abstraction.** Validation x3, pagination x4, git lifecycle twins x4, busy/error triples x7, command lists x3, chunked decoders x2, exe resolvers x2. Every copy is a future divergence; the bench mock passes only because it is wrong in the same direction as the code.
2. **Two sources of truth.** Locks map vs SQLite rows, tasks array vs detail snapshot vs localStorage, raw+parsed event lines, port 8082 hardcoded in 4 places, route contract in 3 files, plus the dead sessionStore.
3. **String contracts.** HTTP status by regexing error messages, server readiness by scraping a vite banner line, provider events via an any-typed if-chain where unknown types silently vanish.
4. **Fire-and-forget lifecycle.** Spawn-once Rust server, chromium never disconnected, PTY sessions never removed on exit, dev servers with no exit handler, an append-only Set of terminal start requests.
5. **Windows-only paths in shared code.** USERPROFILE bun.exe, USERPROFILE opencode.jsonc, projects.json on Desktop, taskkill, powershell benchmarks. M7 is the Linux slice; these are its blockers, and they are in the TypeScript, not the Rust.
## Run lifecycle — POST task to finishRun

```mermaid
sequenceDiagram
  participant FE as TaskDetail.tsx
  participant API as server.ts handleApi
  participant STORE as TaskStore
  participant GIT as GitWorkspaceService
  participant RUNS as AgentRuns
  participant CLI as provider CLI
  participant DB as tasks.sqlite events
  FE->>API: POST /api/tasks
  API->>STORE: createTask()
  STORE-->>FE: 201 TaskRecord rev=1
  FE->>API: POST /api/tasks/:id/workspace
  API->>GIT: create(taskId)
  GIT-->>FE: workspace ready
  FE->>API: POST /api/sessions
  API->>STORE: createRun(taskId,prompt,model,provider,workdir)
  STORE-->>API: RunRecord running eventCount=0
  API->>RUNS: adapter.spawn workdir task model
  RUNS->>CLI: spawn stdio ignore pipe pipe
  CLI-->>RUNS: stdout chunks + stderr
  RUNS->>STORE: appendEvent saber_event raw+items
  STORE->>DB: BEGIN IMMEDIATE INSERT UPDATE
  FE->>API: GET /api/sessions/:id/events wait=1
  API->>STORE: events(id,after) long-poll 25s
  STORE-->>FE: status next lines
  CLI-->>RUNS: close(code)
  RUNS->>STORE: finishRun done/error/stopped
```

## Status state machine

```mermaid
stateDiagram-v2
  [*] --> idle: createTask
  idle --> running: createRun
  running --> done: close code 0
  running --> error: close code !=0
  running --> stopped: stop() taskkill/kill
  running --> interrupted: constructor recovery
  interrupted --> acknowledged: POST acknowledge confirm stopped
  acknowledged --> running: retry createRun
  done --> [*]
  error --> [*]
  stopped --> [*]
  acknowledged --> [*]
  idle -.-> interrupted: illegal, other process live run
```

## Startup gantt

```mermaid
gantt
  title Rust spawn to webview
  dateFormat X
  axisFormat %S
  section boot
  spawn bun dev --strictPort :0, 5
  stdout scrape listening line :5, 15
  health probe 500ms x 20s budget :15, 35
  build webview window :35, 40
  section budgets
  120s startup deadline :0, 120
  20s health deadline :15, 35
```

## Polling storm — 5 timers

```mermaid
gantt
  title Frontend pollers steady state
  dateFormat X
  axisFormat %S
  section TaskWorkspace 2s
  GET /api/tasks :0, 2
  GET /api/tasks :2, 4
  GET /api/tasks :4, 6
  section TaskDetail 1.5s
  GET runs :0, 1
  GET runs :1, 3
  GET runs :3, 5
  section DevServerPane 2s
  GET dev-servers :0, 2
  GET dev-servers :2, 4
  section BrowserPane 2.5s
  GET dev-servers :0, 2
  GET dev-servers :2, 5
  section SessionPane long-poll
  GET events wait=1 25s hold :0, 6
```

Steady idle ~127 req/min: 30 + 40 + 30 + 24 + ~3 long-poll. Live screenshots add 60/min. Active run bursts far higher because SessionPane re-polls 60ms after every non-terminal response.

## SQLite ER — TEXT blobs

```mermaid
erDiagram
  tasks ||--o{ runs : task_id
  tasks ||--o{ verifications : task_id
  runs ||--o{ events : run_id
  runs ||--o{ verifications : run_id
  tasks ||--o{ terminal_sessions : task_id
  tasks {
    TEXT id PK
    TEXT data_blob "id project title spec criteria revision context draft workspace createdAt updatedAt"
  }
  runs {
    TEXT id PK
    TEXT task_id FK
    TEXT data_blob "taskId project task provider model specRevision spec criteria context status eventCount startedAt endedAt exitCode"
  }
  events {
    TEXT run_id FK
    INTEGER seq
    TEXT line
  }
  verifications {
    TEXT id PK
    TEXT task_id FK
    TEXT run_id FK
    TEXT data_blob "criterionId criterionText revision outcome check evidence checkedAt"
  }
  terminal_sessions {
    TEXT id PK
    TEXT task_id FK
    TEXT data_blob "workdir status createdAt startedAt endedAt"
  }
```

## C4 trio index

- Level 1 context: docs/architecture/c4-context.md
- Level 2 containers: docs/architecture/c4-containers.md
- Level 3 subsystems: docs/architecture/c4-components.md

## Provider strategy — args/spawn

```mermaid
classDiagram
  class AgentProvider {
    +name string
    +contextBudget maxPromptChars
    +readOnly supported args reason
    +args(opts) string[]
    +spawn(opts) ChildProcess
  }
  class SpawnOptions {
    +workdir string
    +task string
    +model string
    +session string
    +readOnly bool
  }
  class Opencode {
    +run task --format json --dir workdir
    +run -s session task --format json --dir workdir
    +--model model
  }
  class Codex {
    +exec -c sandbox workspace-write approval never
    +--json --skip-git-repo-check -- model
    +-- task
  }
  class Claude {
    +--print --verbose --output-format stream-json
    +--permission-mode plan --disallowedTools Edit
    +--resume session --model model -- task
  }
  SpawnOptions --> AgentProvider : args/spawn input
  AgentProvider <|-- Opencode
  AgentProvider <|-- Codex
  AgentProvider <|-- Claude
```

## Event pipeline — double store

```mermaid
flowchart LR
  A["spawn stdio ignore/pipe/pipe"] --> B["stdout Buffer chunks"]
  B --> C["StringDecoder utf8 split newline"]
  C --> D["parseProviderEvent any if-chain"]
  D --> E["store x2: appendEvent raw + parsed saber_event"]
  E --> F["SQLite events run_id seq line"]
  F --> G["long-poll GET events wait=1"]
  G --> H["SessionPane x300 reparse JSON"]
  I["stderr data toString slice 16k"] --> E
  J["close code + providerFailed"] --> K["finishRun done/error/stopped"]
```

## Windows/Linux split — M7 blockers

```mermaid
flowchart TB
  subgraph OKBOTH["solid = works both"]
    direction TB
    P1["providers PATH resolver + findExecutable"]
    P2["git worktrees execFile git binary"]
    P3["SQLite WAL tasks.sqlite SABER_DATA_DIR"]
    P4["Rust PTY portable-pty + Tauri invoke"]
  end
  subgraph WINONLY["dashed = Windows-only blocker"]
    direction TB
    W1["devServers USERPROFILE bun.exe path"]
    W2["server.ts opencode.jsonc USERPROFILE path"]
    W3["projects.json Desktop mstudio-os pin"]
    W4["taskkill /PID /T /F stop path"]
    W5["PowerShell bench scripts"]
  end
  P1 --- P2
  W1 -.-> W2
  W3 -.-> W1
  W4 -.-> W5
```

## Worktree layout — two conventions

```mermaid
flowchart TB
  ROOT["SABER_DATA_DIR/worktrees/"] --> T1["task tree: worktrees/taskId"]
  T1 --> B1["branch codex/saber-taskId"]
  ROOT --> R1["run tree: worktrees/taskId/runs/runId"]
  R1 --> B2["branch saber/id8/run8"]
  B1 -.-> NOTE1["task lifecycle create/review/merge/remove"]
  B2 -.-> NOTE2["run lifecycle twin path inconsistent"]
```

## State ownership — three owners

```mermaid
flowchart TB
  subgraph S1["server truth"]
    DBT["tasks.sqlite tasks/runs/verifications/events/terminal_sessions"]
    MEM1["AgentRuns active Map runId to ChildProcess"]
    MEM2["TerminalLocks Map id to lock"]
  end
  subgraph S2["TaskWorkspace owner"]
    TW1["tasks array replaced every 2s"]
    TW2["terminalSessions + openedTerminalTasks Set append-only"]
    TW3["selected string"]
  end
  subgraph S3["TaskDetail owner"]
    TD1["snapshot form never resyncs Save overwrites"]
    TD2["runs array 1.5s poll local runId"]
  end
  subgraph S4["localStorage mirror"]
    LS1["saber.task.id draft form"]
    LS2["saber.selectedTask"]
    LS3["saber.provider.id"]
    LS4["saber.newTask"]
  end
  DBT --> TW1
  DBT --> TD2
  TW1 --> TD1
  TD1 --> LS1
  TW1 --> LS2
```

## Before/after cleanup — god router

```mermaid
flowchart TB
  subgraph BEFORE["before: god router"]
    B0["handleApi 470 LOC 35 endpoints"] --> B1["inline JSON parse"]
    B0 --> B2["regex on message for status"]
    B0 --> B3["contract x3 handler allow-list openapi"]
    B0 --> B4["pagination copy x4"]
  end
  subgraph AFTER["after: route table"]
    A0["routes array pattern method validate handler"] --> A1["typed errors NotFound Conflict Validation"]
    A1 --> A2["status mapped once"]
    A0 --> A3["openapi + allow-list generated"]
  end
```

## Subsystem zoom set

- Rust shell: docs/architecture/zoom-rust.md
- Bun server: docs/architecture/zoom-server.md
- Frontend: docs/architecture/zoom-frontend.md
- Providers: docs/architecture/zoom-providers.md
- Generated route table: scripts/generate-route-table.ts emits docs/architecture/route-table.gen.md from src/server/routes/*.ts; `src/server/routes/routeScan.test.ts` fails if the scanned route set drifts

