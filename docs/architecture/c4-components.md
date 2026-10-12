# C4 Level 3 — per-subsystem

```mermaid
flowchart TB
  subgraph RUSTC["Rust shell"]
    MAIN["main.rs spawn + 120s stdout scrape + 20s health"]
    RT["runtime.rs hand TCP + chunked x2 + contains 200"]
    PTYR["terminal.rs PTY map + 8KB lossy read + no self-remove"]
  end
  subgraph SRVC["Bun server"]
    GOD["server.ts god router regex status"]
    TS["taskStore.ts TEXT JSON N+1 + recovery interrupt"]
    AG["agentRuns spawn decoder parse double-store"]
    GW["gitWorkspaces twins sync execFileSync"]
  end
  subgraph FEC["Frontend"]
    TW["TaskWorkspace 2s replace array"]
    TD["TaskDetail 1.5s snapshot form"]
    SP["SessionPane long-poll 60ms reparse x300"]
  end
  MAIN --> GOD
  TW --> GOD
  TD --> GOD
  SP --> GOD
  AG --> TS
  GOD --> GW
```

Up: [containers](./c4-containers.md). Map: [codebase map](./codebase-map.md). Zooms: [rust](./zoom-rust.md) [server](./zoom-server.md) [frontend](./zoom-frontend.md) [providers](./zoom-providers.md).
