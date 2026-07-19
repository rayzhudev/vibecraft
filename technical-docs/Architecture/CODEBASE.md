# VibeCraft Codebase Documentation

**For AI Assistants and Developers**

This document provides technical documentation for understanding and modifying the VibeCraft codebase. It covers architecture, patterns, data flow, and implementation details.

## Architecture Overview

VibeCraft is an Electron application with a clear separation between the main process (Node.js backend) and renderer process (React frontend). Communication happens via IPC (Inter-Process Communication) through a secure preload bridge.

### Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                          │
├──────────────────────┬───────────────────────────────────┤
│  Main Process        │  Renderer Process                │
│  (Node.js)           │  (React + Browser APIs)          │
│                      │                                   │
│  - File I/O          │  - UI Components                  │
│  - Process Mgmt      │  - Canvas Rendering              │
│  - IPC Handlers      │  - User Interactions             │
│  - Services          │  - State Management              │
│                      │                                   │
│  ┌────────────────┐  │  ┌────────────────────────────┐ │
│  │  IPC Handlers  │◄─┼──┤  IPC Calls (via preload)  │ │
│  └────────────────┘  │  └────────────────────────────┘ │
└──────────────────────┴───────────────────────────────────┘
```

### Key Technologies

- **Electron**: Desktop app framework
- **React**: UI framework
- **TypeScript**: Type safety
- **Vite**: Build tool and dev server
- **xterm.js**: Terminal UI component

## Project Structure

### Main Process (`src/main/`)

The main process handles all system-level operations and cannot access browser APIs.

#### `index.ts`

- Application entry point
- Window creation and management
- Lifecycle hooks (ready, window-all-closed, etc.)
- Registers IPC handlers

#### `ipc.ts`

- All IPC handler registrations
- Maps renderer requests to service calls
- Error handling and logging
- Event emission to renderer

**Key IPC Channels:**

- `load-agents`, `spawn-agent` - Agent management
- `destroy-agent` - Remove an agent and its runtime state
- `load-folders`, `create-folder` - Folder operations
- `list-available-folders`, `import-existing-folder` - Import existing top-level workspace directories
- `delete-folder`, `remove-folder` - Trash vs metadata-only removal (detaches agents)
- `probe-folder-git`, `create-git-worktree`, `worktree-sync-from-source`, `worktree-merge-to-source`, `worktree-undo-merge`, `worktree-retry-restore`, `refresh-folder-conflict-state` - Git/worktree lifecycle and conflict polling
- `agent-attach-to-folder`, `agent-detach` - Agent-folder relationships
- `load-browser-panels`, `create-browser-panel` - Browser management

#### `services/agents/ProcessManager.ts`

Core agent lifecycle management:

- Tracks agent state and terminal history
- Persists terminal history to workspace storage

**Key Methods:**

- `spawnAgent(agent)` - Registers agent state
- `appendHistory(agentId, data)` - Persists terminal output history

#### `services/agentConnect/*`

AgentConnect provider integration:

- Starts provider sessions via the embedded host bridge
- Streams session events into agent terminal entries

#### `services/storage.ts`

JSON file persistence layer:

- Loads/saves agents, folders, browsers, hero data
- Workspace-scoped storage (`.vibecraft/` directory)
- Global settings storage (`~/.vibecraft/`)

**Storage Pattern:**

- All data stored as JSON files
- Per-workspace: `<workspace>/.vibecraft/{agents,folders,browsers,hero}.json`
- Global: `~/.vibecraft/settings.json`

#### `services/workspace.ts`

Folder/project management:

- Creates folder entities
- Validates folder paths
- Manages folder metadata
- Lists existing workspace folders and imports them into metadata
- `updateFolderPosition()` — moves a folder and synchronously displaces all attached agent positions by the same delta, preventing coordinate drift

#### `services/browser.ts`

Browser panel management:

- Creates Electron BrowserView instances
- Manages browser window lifecycle
- Handles URL navigation

#### `mcp/` - Model Context Protocol Server

VibeCraft exposes workspace control via a standards-compliant MCP stdio server (`scripts/vibecraft-mcp.mjs`). The CLI proxies requests to a local HTTP JSON-RPC bridge in the Electron main process (`src/main/mcp/server.ts`), which relays into renderer command/layout bridges.

**Architecture:**

```
┌──────────────────────────────┐  MCP stdio  ┌──────────────────────────────┐
│       AI Agent (Claude)      │───────────>│  vibecraft-mcp CLI            │
└──────────────────────────────┘            │  scripts/vibecraft-mcp.mjs     │
                                            └──────────────┬───────────────┘
                                                           │ HTTP JSON-RPC
                                                           ▼
                                            ┌──────────────────────────────┐
                                            │  MCP Bridge (main process)   │
                                            │  src/main/mcp/server.ts      │
                                            └──────────────┬───────────────┘
                                                           │
                                           ┌───────────────┼───────────────┐
                                           ▼               ▼               ▼
                                    ┌──────────┐   ┌──────────────┐  ┌──────────┐
                                    │ Command  │   │   Layout     │  │ Workspace│
                                    │ Bridge   │   │   Bridge     │  │  Client  │
                                    └──────────┘   └──────────────┘  └──────────┘
                                                           │
                                                           ▼
                                                ┌──────────────────────┐
                                                │  Renderer Process    │
                                                │  (WorkspaceView)     │
                                                └──────────────────────┘
```

**Key Files:**

##### `scripts/vibecraft-mcp.mjs`

Standards-compliant MCP server implementation:

- Implements MCP over stdio using `@modelcontextprotocol/sdk`
- Exposes tools (`vibecraft.command`, `vibecraft.batch`, `vibecraft.layout`, `vibecraft.commands`)
- Implements `resources/list` and `resources/read` for command metadata
- Reads `.vibecraft/mcp.json` to reach the local bridge

##### `mcp/server.ts`

Local HTTP bridge used by the CLI:

- JSON-RPC 2.0 over HTTP on localhost
- Handles tool discovery (`tools/list`) and execution (`tools/call`)
- Provides command documentation via resources endpoints
- Writes `.vibecraft/mcp.json` with host/port for the CLI

**MCP Tools:**

1. **`vibecraft.command`** - Execute single workspace command
   - Takes `{ command: { id, args?, source? } }`
   - Returns success/error result
   - Validates command IDs via enum

2. **`vibecraft.commands`** - Discover all available commands
   - Takes no arguments
   - Returns comprehensive command metadata with schemas
   - Includes examples, arg types, and categorization

3. **`vibecraft.layout`** - Get workspace state
   - Takes no arguments
   - Returns all entities (hero, agents, folders, browsers, terminals)
   - Provides context for spatial reasoning

4. **`vibecraft.batch`** - Execute multiple commands atomically
   - Takes `{ commands: Array<{ id, args? }> }`
   - Executes all commands in sequence
   - Returns array of results with detailed error info

**Protocol Flow:**

```
Agent → {"jsonrpc":"2.0","id":1,"method":"tools/list"}
Server → {"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}

Agent → {"jsonrpc":"2.0","id":2,"method":"tools/call",
         "params":{"name":"vibecraft.commands","arguments":{}}}
Server → {"jsonrpc":"2.0","id":2,"result":{"content":[{
           "type":"text","text":"{commands:[...]}"
         }]}}

Agent → {"jsonrpc":"2.0","id":3,"method":"tools/call",
         "params":{"name":"vibecraft.command",
                   "arguments":{"command":{"id":"create-agent-claude","args":{"x":100,"y":200}}}}}
Server → {"jsonrpc":"2.0","id":3,"result":{"content":[...]}}
```

##### `mcp/commandMetadata.ts`

Comprehensive command documentation registry:

```typescript
export interface CommandMetadata {
  id: CommandId;
  title: string;
  description: string;
  category: 'agent' | 'folder' | 'browser' | 'terminal' | 'hero' | 'worktree';
  args: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'object';
      required: boolean;
      description: string;
      default?: unknown;
    };
  };
  example: {
    id: CommandId;
    args?: Record<string, unknown>;
  };
}
```

**Exports:**

- `COMMAND_METADATA` - Array of all 29 command metadata objects
- `COMMAND_IDS` - String array of all valid command IDs
- `COMMANDS_BY_CATEGORY` - Commands grouped by entity type

**Command Categories:**

- **agent** (8 commands): create-agent-claude, create-agent-codex, move-agent, attach-folder, detach-agent, open-agent-terminal, clear-history, destroy-agent
- **folder** (5 commands): create-folder, move-folder, rename-folder, remove-folder, delete-folder
- **browser** (6 commands): create-browser, move-browser, resize-browser, refresh-browser, delete-browser
- **terminal** (4 commands): create-terminal, move-terminal, resize-terminal, delete-terminal
- **hero** (1 commands): move-hero
- **worktree** (5 commands): create-worktree, worktree-sync, worktree-merge, undo-merge, retry-restore
- **global** (1 command): move-entity (generic)

##### `mcp/commandTools.ts`

Bridge helpers for renderer command execution:

- `runCommandTool()` - Executes a single renderer command from the bridge
- `runCommandsTool()` - Executes a batch of renderer commands from the bridge

**Command Bridge Integration:**

The MCP CLI delegates command execution to the bridge and command bridge system:

```
MCP CLI (stdio)
  → HTTP bridge (mcp/server.ts)
  → commandBridge.executeCommand({ id, args, source: 'mcp' })
  → Renderer receives via IPC
  → WorkspaceView processes command
  → Result returned to bridge
  → Formatted as MCP tool result
```

**Lifecycle Management:**

- Bridge lifecycle tied to workspace activation
- Bridge starts when workspace view mounts and stops on unmount
- MCP stdio server is launched by MCP clients as needed
- Proper cleanup prevents orphaned bridge processes

**Error Handling:**

- Invalid JSON-RPC → Parse error response
- Unknown method → Method not found error
- Tool execution failure → Detailed error with context
- Timeout handling for long-running operations

**Agent Discovery Pattern:**

AI agents can self-discover VibeCraft's capabilities:

1. Call `vibecraft.commands` to get all available commands
2. Parse metadata to understand arguments and examples
3. Call `vibecraft.layout` to understand workspace state
4. Execute commands via `vibecraft.command` or `vibecraft.batch`
5. No trial-and-error needed - schemas provide complete documentation

**Testing the MCP Server:**

```bash
# Start VibeCraft and open a workspace (bridge writes .vibecraft/mcp.json)
# Start the stdio MCP server and send JSON-RPC requests

# Discovery
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | node scripts/vibecraft-mcp.mjs --workspace /path/to/workspace

# Get all commands
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vibecraft.commands","arguments":{}}}' \
  | node scripts/vibecraft-mcp.mjs --workspace /path/to/workspace

# Execute command
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"vibecraft.command","arguments":{"command":{"id":"create-agent-claude","args":{"x":100,"y":200}}}}}' \
  | node scripts/vibecraft-mcp.mjs --workspace /path/to/workspace
```

### Renderer Process (`src/renderer/`)

The renderer process runs React and handles all UI.

#### `App.tsx`

Main application component with routing:

- Home screen → Workspace selection → Workspace view
- Manages workspace state
- Handles navigation between screens

#### `screens/WorkspaceView.tsx`

**Core workspace component** - This is where most of the application logic lives:

- Manages all entity state (hero, agents, folders, browsers)
- Handles entity selection and abilities
- Coordinates terminal panels
- Manages dialogs (input, message, folder select)
- Computes agent status and folder git/worktree state
- Handles entity movement and positioning, inline rename dropdown (with import-by-rename)
- Delegates data loading/mutations to hooks/services to keep UI code lean
- Maintains local camera diagnostics in `WorkspaceCanvas` (FPS/frame + render metrics overlay, adaptive reduced-effects tier)

**Key State:**

- `hero`, `agents`, `folders`, `browsers` - Entity arrays
- `selectedEntity` - Currently selected entity
- `terminals` - Terminal panel positions per agent
- `thinkingAgents` - Set of agents actively receiving terminal data
- `availableFolders` - Top-level folders available to import/rename-relate
- `renamingFolderId`, `renameValue`, `renameDropdownOpen` - Inline rename UI state
- `folderGitInfo` - Probe results for selected folder

**Key Handlers:**

- `handleSelect(id, type)` - Selects an entity
- `handleAbility(ability)` - Processes entity abilities (agent destroy, folder trash/remove, worktree sync/merge/undo/retry, inline rename)
- `handleAgentMove`, `handleFolderMove` - Updates entity positions
- `handleConflictPoll` - Polls merge/restore conflicts to clear UI state once resolved

**Renderer architecture guidelines**

- Keep UI components declarative; data fetching/mutations live in hooks under `src/renderer/hooks/`.
- Use `workspaceClient` (`src/renderer/services/workspaceClient.ts`) as the only place that touches `window.electronAPI`.
- Keep side-effect orchestration in hooks (`useWorkspaceEntities`, `useWorktreeConflicts`, `useTerminalManager`) and pass down plain props/callbacks to UI components.
- Inline rename dropdown (with available-folder relink) stays in canvas components; long-running flows (worktree merge, conflict polling, detach cascade) stay in hooks/services to avoid UI bloat.
- When reviewing UI changes, verify components stay consistent with the theme system (see `../Reference/THEME_GUIDE.md` and theme tokens) rather than hard-coding colors or spacing.

#### `components/canvas/Canvas.tsx`

Canvas container with pan/zoom:

- Manages viewport transform (translate + scale)
- Handles mouse events for panning
- Wheel events for zooming
- Click detection for empty space
- Batches `onCameraChange` notifications with `requestAnimationFrame` so minimap/camera listeners are updated at most once per frame
- Memoizes the zoom context payload so pan-only updates do not force rerenders in zoom-context consumers (drag/panel hooks)
- Under high entity counts, camera-to-minimap synchronization is throttled to reduce panning cost while keeping canvas transforms smooth
- During active pan/wheel movement, the workspace stage enters a temporary `pan-optimizing` mode that suppresses expensive browser webview and terminal xterm painting

**Transform Pattern:**

```typescript
transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
```

#### `components/canvas/Entity.tsx`

Shared entity wrapper:

- Applies `data-entity-*` attributes for selection/testing
- Handles selection click propagation
- Supports optional `{ x, y }` transform for world positioning
- Does not implement drag, resize, or selection visuals

**Entity Pattern:**
All canvas entities flow through `Entity`, but behavior is layered by role:

- **Units** (`UnitEntity`) add drag behavior and selection rings (Hero, Agent).
- **Buildings** (`BuildingEntity`) share the wrapper without rings.
- **Windowed Buildings** (`WindowedBuildingEntity`) are Browser + Terminal; they use their own window chrome/outline for selection, not rings.
- **Folder** is the current non-windowed building and renders its own selection ring.

#### `components/canvas/UnitEntity.tsx`

Unit-specific base:

- Uses `useEntityDrag` for movement
- Renders the circular `SelectionIndicator`
- Used by Hero + Agent entities

#### `components/canvas/BuildingEntity.tsx`

Building base:

- Shared wrapper for Folder, Browser, Terminal
- No selection ring by default

#### `components/canvas/WindowedBuildingEntity.tsx`

Windowed building base:

- Browser + Terminal window frames
- Relies on window outline/highlight for selection state

#### `components/canvas/AgentEntity.tsx`

Agent-specific entity:

- Status indicator (color-coded)
- Provider icon (Claude 🤖 or Codex 🧠)
- Visual effects (thinking floaters, status change animations)
- Badges (attached folder, terminal open)
- Supports `reduceEffects` mode used by runtime performance adaptation to suppress high-cost visual effects under sustained low FPS

**Status Colors:**

- `idle`: #888 (gray)
- `starting`: #f9a825 (yellow)
- `online`: #4caf50 (green)
- `stopping`: #ff9800 (orange)
- `offline`: #666 (dark gray)
- `error`: #f44336 (red)

#### `components/hud/HUD.tsx`

HUD container component:

- Shows when entity is selected
- Composes DetailsPanel and AbilitiesPanel
- Empty state when nothing selected

#### `components/hud/AbilitiesPanel.tsx`

Ability buttons for selected entity:

- Entity-type-specific abilities
- Hero: No abilities (moved to WorldAbilityPanel)
- Agent: Terminal, Clear History, Attach/Detach, Destroy
- Folder: Inline Rename, Delete (trash), Remove (metadata only), Worktree (create/sync/merge), Conflict undo/retry
- Browser: Refresh, Close

#### `components/hud/WorldAbilityPanel.tsx`

Global creation abilities:

- Create Claude Agent
- Create Codex Agent
- Create Project (Folder)
- Create Browser Panel

#### `components/canvas/TerminalEntity.tsx`

Terminal window component:

- Uses xterm.js for terminal rendering
- Manages terminal history
- Draggable and resizable

### Shared Types (`src/shared/types.ts`)

Central type definitions used by both main and renderer:

**Core Entities:**

- `Agent` - Agent definition with position, status, provider
- `Hero` - Hero entity
- `Folder` - Project/folder entity
- `BrowserPanel` - Browser window entity
- `TerminalPanel` - Workspace terminal window entity (rendered by `TerminalEntity`)
- `Workspace` - Workspace metadata

**State Types:**

- `AgentStatus` - Union type for agent states
- `AgentProvider` - 'claude' | 'codex' | 'cursor' | 'local'
- `EntityType` - 'hero' | 'agent' | 'folder' | 'browser' | 'terminal'
- `EntityKind` - 'unit' | 'building'
- `WorldEntity` - Normalized runtime entity union with `type` + `entityKind`
- `SelectedEntityRef` - Selection state (id + type)

**IPC Types:**

- `ElectronAPI` - Complete IPC API interface
- `SpawnAgentPayload` - Agent creation payload
- `AttachAgentPayload` - Agent-folder attachment payload

### Preload (`src/preload.ts`)

Secure IPC bridge:

- Exposes `window.electronAPI` to renderer
- Validates IPC channels
- Provides type-safe API surface
- Prevents renderer from accessing Node.js directly

## Data Flow Patterns

### Agent Lifecycle

1. **Spawn Agent:**

   ```
   Renderer → IPC: spawn-agent
   Main → ProcessManager.spawnAgent()
   Main → Storage.saveAgents()
   Main → IPC Event: agent-status (idle → starting)
   ProcessManager → Start process
   Main → IPC Event: agent-status (starting → online)
   ```

2. **Attach Agent to Folder:**

   ```
   Renderer → IPC: agent-attach-to-folder
   Main → Storage.updateAgent()
   Main → IPC Event: agent-status (idle → starting → online)
   ```

3. **Folder Move (Agent Position Sync):**

   When a folder is moved, `updateFolderPosition` in `workspace.ts` calculates the
   positional delta (`dx`, `dy`) and synchronously updates the stored positions of
   all agents attached to that folder in `agents.json`. This ensures agents move
   with their parent folder and prevents coordinate drift that would cause the
   magnetism system to incorrectly detach them.

   ```
   Renderer → handleFolderMove() → setFolders + setAgents (optimistic)
   Renderer → IPC: update-folder-position
   Main → workspace.updateFolderPosition()
           ├─ Update folder in folders.json
           └─ Update attached agent positions in agents.json (dx, dy)
   ```

4. **Agent Detachment (Gravity Check):**

   Agent detachment from folders is evaluated deterministically inside
   `handleAgentDragEnd` in `useAgentMagnetism.ts`, **not** via a reactive
   `useEffect`. When the user drops an agent, the handler checks whether the
   final drop position is outside the gravity radius of the agent's attached
   folder. If so, it triggers `detachAgent()` and updates local state.

   This avoids race conditions where asynchronous IPC state updates could
   momentarily clobber frontend coordinates and trigger spurious detachments.

5. **Agent Run:**
   ```
   Renderer → IPC: agentconnect-run-agent
   Main → AgentConnect service starts run
   Main → IPC Event: agentconnect-event
   Renderer → AgentTerminalPanel renders stream
   ```

### Entity Selection Flow

1. User clicks entity
2. `Entity.onSelect()` → `WorkspaceView.handleSelect()`
3. `setSelectedEntityRef({ id, type })`
4. `selectedEntity` derives from current entity data
5. `DetailsPanel` and `AbilitiesPanel` render entity-specific content

### Ability Execution Flow

1. User clicks ability button in `AbilitiesPanel`
2. `onAbility(ability)` → `WorkspaceView.handleAbility()`
3. Ability handler:
   - Shows dialog if needed (input, folder select)
   - Calls IPC method
   - Updates local state
   - Handles errors

## Key Patterns & Conventions

### Mechanics Isolation Pattern

We treat each **mechanic** as a focused unit of behavior (movement, attach/magnetism, selection, z-index, etc.).
Mechanics should be isolated to reduce cross-coupling and bugs.

**Layering order (applies across the codebase):**

1. **Pure math/layout utilities**  
   Stateless helpers and geometry math. No React, no IPC, no mutable refs.

2. **Mechanics modules**  
   One behavior per module (hook in the renderer, service in the main process).  
   These modules accept dependencies as parameters and return a minimal public surface.

3. **Managers / Services**  
   IO, persistence, IPC, and process coordination. Managers call mechanics but do not embed their logic.

4. **Composition / Orchestration**  
   Controllers or IPC handlers wire multiple mechanics together.  
   Orchestrators should be thin and free of new behavior logic.

5. **View**  
   UI components that render state and call back into controllers.

**Rules:**

- Mechanics do not import each other.
- Orchestration is the only place where multiple mechanics meet.
- Avoid shared mutable state across mechanics; pass dependencies in.
- If a controller grows, extract the behavior into a new mechanic module.

**Example:** The workspace screen follows this structure in  
`src/renderer/screens/workspace/README.md`.

### Entity Positioning

All entities use `x` and `y` coordinates on the canvas:

- Hero: `{ x, y }`
- Agents: `{ x, y }`
- Folders: `{ x, y }`
- Browsers: `{ x, y }` (also has `width`, `height`)
- Workspace terminals: `{ x, y }` (also has `width`, `height`)

### Status Management

Agent status is computed and synchronized:

- Backend (ProcessManager) tracks actual process state
- Frontend (WorkspaceView) displays status
- Status updates via IPC events: `onAgentStatus`
- Status persisted in `agents.json`

### Terminal Management

Terminals are split by scope:

- Agent terminals are per-agent overlays (one per agent)
- Workspace terminals are windowed buildings tracked in `terminals`
- Terminal z-index managed separately from browser z-index
- Terminal closes when agent is stopped

### Dialog Pattern

Dialogs use controlled state:

```typescript
const [inputDialog, setInputDialog] = useState<DialogState | null>(null);

// Show dialog
setInputDialog({ title, onConfirm: (value) => { ... } });

// In JSX
{inputDialog && <InputDialog {...inputDialog} onClose={() => setInputDialog(null)} />}
```

### IPC Event Pattern

Events use subscription pattern:

```typescript
// In renderer
const unsubscribe = window.electronAPI.onAgentStatus((data) => {
  // Handle status update
});

// Cleanup
useEffect(() => {
  return unsubscribe;
}, []);
```

## Styling & Theme System

The renderer styling is split between reusable CSS modules and a typed theme registry so every visual surface can be re-themed safely without duplicating entire stylesheets.

### Style File Organization

- `src/renderer/styles/index.css` is just an import hub. It pulls in base styles, layout sheets, and component-specific files (sidebar, canvas, HUD, dialogs, etc.).
- Each CSS file assumes all baseline values come from CSS variables populated by the active theme. Avoid hard-coded colors/spacing so themes remain authoritative.

### Layered Theme Model

Themes are authored in three layers, all defined in `src/renderer/theme/tokens.ts`:

1. **Foundation tokens (required).** Colors, typography, spacing, panel/background surfaces, button text colors, etc. If a foundation token were missing the screen would be unreadable, so TypeScript enforces their presence.
2. **Component overrides (optional).** Override tokens let a theme change a specific treatment (home-title glow, menu bevel, world-card gradient). CSS uses `var(--token, fallback)` so the UI falls back to the foundation palette when the override is missing.
3. **Theme modules (optional React/CSS hooks).** Advanced themes can supply extra UI such as particle systems or bespoke overlays. Components look for these hooks (e.g., `theme.modules?.menuButtonDecoration?.(props)`) and mount them when present. Theme modules also include non-visual defaults such as `theme.modules?.audio?.defaultSoundPackId` for audio pack resolution.
4. **Copy/content (required).** Narrative elements such as the home-screen subtitle variants live in `copy.home.subtitleOptions`, letting each theme define its own phrases or localization.

### Essential vs Optional Rule

Use this rule whenever you add new visual flourishes:

> **If removing the value would make the UI unusable or illegible, it is essential and belongs in the foundation set.**  
> **If the UI still functions without it, treat it as an optional override or module.**

Applying that rule keeps the essential set small (title/subtitle styles, background image, baseline menu button styling) while allowing themes to add decorative pieces such as glows, particles, or embossing without forcing every other theme to copy them.

### Adding or Updating a Theme

1. Define the foundation token values in `themeRegistry`. TypeScript guarantees you supply everything required.
2. Optionally provide component overrides (`overrides.home`, `overrides.world`, etc.) only when you want to change that feature’s look.
3. Optionally export theme modules for bespoke behavior (e.g., `menuButtonDecoration`). Modules receive controlled props so they can render additional JSX/CSS safely.
4. (Optional) expose the theme in the UI via `useTheme()` switching logic.

`ThemeProvider` applies the foundation variables to `document.documentElement`, merges optional overrides, and wires up any registered modules. Refer to `../Reference/THEME_GUIDE.md` for a complete description of the primitive schema and authoring workflow. This layered approach keeps themes strongly typed while also allowing radically different looks without bloating the “essential” contract.

Renderer audio selection is resolved independently from theme visuals. The effective sound pack is selected with precedence: `settings.audio.soundPackOverrideId` -> `activeTheme.modules.audio.defaultSoundPackId` -> `default`.

### Developer Checklist

To keep every new screen themeable, follow these rules when building UI or themes:

- **No literal styling.** Consume CSS variables only (e.g., `color: var(--text-primary)`) and provide fallbacks for optional values (`var(--home-button-hover-start, var(--home-button-gradient-start))`).
- **Fonts come from the theme.** Apply `var(--font-base)`, `var(--font-display)`, or `var(--font-mono)` instead of hardcoding font stacks.
- **Decide “essential vs optional”.** If the UI is unusable without a value, add a foundation token. Otherwise add an override token (and document it) or expose a module hook.
- **Update docs when adding tokens.** Whenever you introduce a new foundation/override token, describe it here so theme authors know how to populate it.
- **Expose module hooks deliberately.** Use `const { activeTheme } = useTheme()` and render `activeTheme.modules?.<hook>()` only where themes may want bespoke effects.
- **Keep CSS modular.** New styles belong in their own file under `src/renderer/styles/` so they inherit the shared variables automatically.
- **Test with missing overrides.** Temporarily remove optional overrides in the default theme to ensure the component still looks reasonable (the fallback path).

## Storage Schema

### `agents.json`

```typescript
Agent[] = [
  {
    id: string,
    provider: 'claude' | 'codex' | 'cursor' | 'local',
    model: string,
    agentConnectSessionId?: string | null,
    providerSessionId?: string | null,
    contextWindow?: number,
    contextLeft?: number,
    totalTokensUsed?: number,
    name: string,
    displayName: string,
    workspacePath: string,
    x: number,
    y: number,
    status: AgentStatus,
    attachedFolderId?: string,
    terminalId?: string
  }
]
```

### `folders.json`

```typescript
Folder[] = [
  {
    id: string,
    name: string,
    relativePath: string,
    x: number,
    y: number,
    createdAt: number
  }
]
```

### `browsers.json`

```typescript
BrowserPanel[] = [
  {
    id: string,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    createdAt: number
  }
]
```

### `hero.json`

```typescript
Hero = {
  id: 'hero',
  name: string,
  x: number,
  y: number,
};
```

## IPC API Reference

### Workspace Operations

- `getRecentWorkspaces()` → `Workspace[]`
- `addRecentWorkspace(workspace)` → `boolean`
- `selectFolder(options?)` → `string | null` (returns folder path)

### Agent Operations

- `loadAgents(workspacePath)` → `Agent[]`
- `spawnAgent(payload)` → `{ success, agent?, error? }`
- `updateAgentPosition(workspacePath, agentId, x, y)` → `boolean`
- `agentAttachToFolder(payload)` → `{ success, error? }`
- `agentDetach(agentId, workspacePath)` → `{ success, error? }`

### Terminal Operations

- `getTerminalHistory(agentId)` → `{ success, history }`
- `clearTerminalHistory(agentId)` → `{ success }`

### Folder Operations

- `loadFolders(workspacePath)` → `Folder[]`
- `createFolder(workspacePath, name, x, y)` → `{ success, folder?, error? }`
- `renameFolder(workspacePath, oldName, newName)` → `boolean`
- `removeFolder(workspacePath, folderId)` → `boolean`
- `deleteFolder(workspacePath, folderId)` → `{ success, error? }`
- `updateFolderPosition(workspacePath, name, x, y)` → `boolean`

### Browser Operations

- `loadBrowserPanels(workspacePath)` → `BrowserPanel[]`
- `createBrowserPanel(workspacePath, url, x, y, width, height)` → `{ success, panel? }`
- `deleteBrowserPanel(workspacePath, id)` → `boolean`
- `updateBrowserPanel(workspacePath, id, updates)` → `boolean`

### Events

- `onAgentStatus(handler)` → `unsubscribe()`

## Development Guidelines

### Adding a New Entity Type

1. **Define Type** in `shared/types.ts`:

   ```typescript
   export interface NewEntity {
     id: string;
     // ... properties
   }
   ```

2. **Update EntityType** union:

   ```typescript
   export type EntityType = 'hero' | 'agent' | 'folder' | 'browser' | 'newentity';
   ```

3. **Create Entity Component** in `components/canvas/NewEntityEntity.tsx`

4. **Add to WorkspaceView**:
   - State: `const [newEntities, setNewEntities] = useState<NewEntity[]>([]);`
   - Render in Canvas
   - Add to `getSelectedData()`
   - Add ability handlers

5. **Update HUD**:
   - Add to `DetailsPanel`
   - Add to `AbilitiesPanel`

6. **Add Storage** in `services/storage.ts`

7. **Add IPC Handlers** in `main/ipc.ts`

### Adding a New Agent Provider

1. **Create Runner** in `services/agents/NewProviderRunner.ts`:

   ```typescript
   export function buildCommand(agent: Agent): { command: string; args: string[] } {
     // Return command and args
   }
   ```

2. **Update ProcessManager** to use new runner

3. **Update AgentProvider** type in `shared/types.ts`

4. **Update UI** to show provider icon/name

### Error Handling Pattern

```typescript
try {
  const result = await window.electronAPI.someOperation();
  if (!result.success) {
    setMessageDialog({ title: 'Error', message: result.error, type: 'error' });
    return;
  }
  // Handle success
} catch (err) {
  setMessageDialog({ title: 'Error', message: String(err), type: 'error' });
}
```

### State Update Pattern

Always update both:

1. Local React state (for immediate UI update)
2. Backend storage (for persistence)

```typescript
// Update local state
setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, unitX: x, unitY: y } : a)));

// Persist to backend
await window.electronAPI.updateAgentPosition(workspacePath, id, x, y);
```

## Testing Considerations

- **IPC Communication**: Test IPC handlers in isolation
- **State Management**: Test entity state updates
- **Canvas Interactions**: Test drag, pan, zoom
- **Terminal**: Test PTY communication
- **Storage**: Test JSON persistence

## Common Pitfalls

1. **Forgetting to persist state**: Always call storage IPC after local state updates
2. **Z-index conflicts**: Browsers and terminals share z-index counter
3. **Terminal cleanup**: Ensure terminals close when agents stop
4. **Status synchronization**: Backend process state must match frontend display
5. **Canvas coordinates**: Remember to account for pan/zoom when calculating positions

## Future Architecture Considerations

- Consider state management library (Zustand, Redux) if state becomes complex
- Consider React Query for async state management
- Consider WebSocket for real-time updates if needed
- Consider virtualizing canvas entities for performance with many entities
