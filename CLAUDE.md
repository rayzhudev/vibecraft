# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is VibeCraft

VibeCraft is an Electron desktop application that provides an RTS-style visual workspace for managing AI coding agents. Users interact with a pannable/zoomable 2D canvas populated with entities: a Hero (command center), Agents (AI units running Claude/Codex), Folders (filesystem-backed project entities), Terminals, and Browser panels.

## Commands

All commands use **Bun** as the package manager.

```bash
bun run dev           # Start dev server with hot reload
bun run build         # Production build
bun run check         # Typecheck + lint + format check (run before committing)
bun run typecheck     # TypeScript type checking only
bun run lint          # ESLint only
bun run format        # Auto-fix formatting with Prettier

bun run test          # Full test suite
bun run test:unit     # Unit tests only (Vitest)
bun run test:e2e      # E2E tests (Playwright)
bun run test:mcp      # MCP protocol tests
bun run test:perf     # Performance benchmarks

bun run package       # Build + package distributable app
```

To run a single unit test file:

```bash
bunx vitest run tests/unit/path/to/test.spec.ts
```

## Process Architecture

VibeCraft uses Electron's two-process model with strict separation:

```
Main Process (Node.js)          Renderer Process (React)
src/main/                       src/renderer/
├── index.ts (entry, window)    ├── screens/workspace/  (game logic)
├── ipc.ts (all IPC handlers)   ├── components/canvas/  (entity rendering)
├── services/                   ├── components/hud/     (UI panels)
│   ├── agentConnect/           ├── hooks/              (mechanics)
│   ├── agents/ProcessManager   ├── services/workspaceClient.ts  ← ONLY file touching window.electronAPI
│   ├── storage.ts              ├── state/
│   └── workspace.ts            └── theme/
├── mcp/server.ts
└── commandBridge.ts
```

**IPC rule**: All renderer→main communication goes through `src/renderer/services/workspaceClient.ts`. Never call `window.electronAPI` directly elsewhere.

## Key Architectural Patterns

### IPC Communication

- Renderer calls `workspaceClient.ts` → `preload.ts` bridge → `src/main/ipc.ts` handlers → services
- All IPC responses follow `{ success: boolean, error?: string, data?: T }` shape
- Events (main→renderer) use subscription pattern with unsubscribe cleanup

### Storage

- Per-workspace: `<project>/.vibecraft/{agents,folders,browsers,hero}.json`
- Global settings: `~/.vibecraft/settings.json`
- No database — pure JSON file persistence via `src/main/services/storage.ts`

### Canvas Mechanics Isolation (renderer)

The workspace UI uses a strict layered pattern:

1. Pure math/layout utilities (no React)
2. Mechanics hooks (one responsibility each: movement, magnetism, selection, etc.)
3. Manager hooks (compose mechanics)
4. View components

No cross-mechanic dependencies. Each mechanic in `src/renderer/hooks/` handles exactly one concern.

### Theme System (3-layer model)

- **Foundation tokens** (required): CSS variables for colors, typography, spacing — defined in `src/renderer/theme/tokens.ts`
- **Component overrides** (optional): Per-component CSS module overrides
- **Theme modules** (optional): React/CSS hooks for dynamic theming
- Rule: if the UI is unusable without a token, it's a foundation token; otherwise optional

### MCP Integration

- Stdio server at `scripts/vibecraft-mcp.mjs` implements MCP protocol
- HTTP JSON-RPC bridge at `src/main/mcp/server.ts` relays to renderer
- 4 tools: `vibecraft.command`, `vibecraft.commands`, `vibecraft.layout`, `vibecraft.batch`
- Command metadata (schemas, descriptions, examples) lives in `src/main/mcp/commandMetadata.ts`

## Central Type Definitions

All shared types are in `src/shared/types.ts`. Check here first before defining new types — it contains Agent, Folder, BrowserPanel, Hero, WorkspaceState, and all related interfaces.

## Key Files

| File                                               | Purpose                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `src/shared/types.ts`                              | All shared TypeScript interfaces                                  |
| `src/main/ipc.ts`                                  | Every IPC channel handler (~77KB — the authoritative API surface) |
| `src/main/services/storage.ts`                     | JSON persistence, storage schemas                                 |
| `src/renderer/screens/workspace/WorkspaceView.tsx` | Core game state and composition                                   |
| `src/renderer/services/workspaceClient.ts`         | Only renderer↔main IPC bridge                                     |
| `technical-docs/Architecture/CODEBASE.md`          | Deep-dive reference for IPC API, storage schemas, patterns        |
| `technical-docs/Reference/TESTING.md`              | Testing strategy and patterns                                     |
| `technical-docs/Reference/THEME_GUIDE.md`          | Theme system guide                                                |
