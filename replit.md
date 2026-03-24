# Team Snek Bot - Battlesnake AI

## Overview

Team Snek Bot is a TypeScript-based Battlesnake AI that implements a sophisticated team-based strategy using Voronoi territory analysis. The bot is designed to compete in a **custom Battlesnake engine that allows both human players and AI bots to compete in the same game** - a unique testing environment where humans can directly challenge and analyze bot behavior. The bot uses team-based coordination (when teams are present) and focuses on maximizing controlled territory through Voronoi diagrams while avoiding fatal collisions, particularly head-to-head encounters with larger snakes.

## Game Variant Rules

This bot is specifically designed to play a team-based Battlesnake variant with the following unique rules:

**King Bot Scoring System:**
- Each team has a designated "king" snake (which this bot plays as)
- The team's final score is determined **solely by the king's length** at the end of the game
- The game ends when either:
  - At most one team remains alive, OR
  - 100 turns have elapsed (whichever happens first)

**Strategic Implications:**
- **Survival is paramount**: The king must protect its life at all costs since death means zero points
- **Conservative play**: Avoid risky confrontations, especially head-to-head collisions with larger snakes
- **Maximize food collection**: Since score = length, collecting food directly increases the team's score
- **Territory control**: Controlling food-rich territory is essential for sustained growth
- **Food proximity vs. consumption**: The bot distinguishes between:
  - Being near food (proximity) - important for positioning
  - Actually eating food - directly increases score and should be highly rewarded

## User Preferences

- Preferred communication style: Simple, everyday language.
- **Technical Debt Policy**: Prioritize minimizing technical debt over backwards compatibility. Clean, maintainable code is more important than supporting deprecated features since there are no external users.

## Critical System Synchronization Notes

**IMPORTANT: When making changes to the Battlesnake AI system, ensure ALL components remain synchronized:**

1. **Backend-Frontend Data Flow**: Changes to data structures in the backend (board-evaluator.ts, decision-engine.ts, voronoi-strategy-new.ts) MUST be reflected in:
   - Decision logger database schema (decision-logger.ts)
   - Frontend UI display logic (src/web/history.html)
   - Any API response formats

2. **Adding New Heuristics Pattern**: When adding ANY new heuristic to the snake AI:
   - Add to core logic (board-evaluator.ts, decision-engine.ts)
   - Add to configuration interface (src/web/config.html)
   - **MUST ALSO** add to history viewer (src/web/history.html) for display
   - Update both weighted sums initialization AND display metrics config
   - Failure to update BOTH config and history will result in incomplete UI

3. **Field Name Changes**: If renaming or restructuring fields (e.g., fertileTerritory → myTerritory + myControlledFood):
   - Update TypeScript interfaces in ALL files
   - Update database logging to use new field names
   - Update frontend JavaScript to read and display new field names
   - Ensure backward compatibility for existing logged data

4. **Testing Must Be End-to-End**: 
   - Don't just check console logs or API responses
   - ALWAYS open the Game History viewer UI to verify changes are displayed correctly
   - Test with actual game data from the database, not just curl commands

5. **Common Failure Points**:
   - Frontend UI still using old field names while backend uses new ones
   - Weighted score calculations not matching between backend and frontend
   - Database schema out of sync with logged data structure
   - Total scores not adding up correctly in the UI
   - **New heuristics missing from history viewer while present in config**

Remember: A change isn't complete until it works in the user-facing UI, not just in the logs!

## Game History Viewer Features

### Voronoi Territory Visualization (Added 2025-12-17)
The Game History viewer now displays Voronoi territory overlays on the game board:
- **Territory Overlay**: Each snake's controlled territory is displayed with the snake's color at 15% opacity
- **Click to Highlight**: Click on any snake's territory to highlight it (increases opacity to 40%)
- **Click Again to Deselect**: Click the same territory again or click empty space to remove highlight
- **Data Storage**: Territory cells are stored in `move_evaluations` JSONB field as `{evaluations: [...], territoryCells: {...}}`
- **Backward Compatibility**: Frontend handles both old array format and new object format for move_evaluations

**Note**: Territory visualization only appears for games logged after 2025-12-17. Older game logs don't have territory cell data.

## Known Replit Platform Issues

### Broken run_test Tool (Beta) - Critical Testing Limitation

**Issue**: The Replit run_test tool for browser-based UI testing is fundamentally broken and cannot be used reliably.

**Observed Behavior**:
- Tool appears temporarily when app testing is toggled on/off but disappears immediately on subsequent conversation turns
- Even when present in the tool list, attempting to invoke it fails silently or with errors
- Tool injection appears to happen only on the exact turn when app testing is toggled, not persisting beyond that
- System prompt continues to reference the tool even when it's not available in the actual tool set
- Switching between Plan/Build modes does not restore the tool
- Disabling "high power mode" does not fix the issue

**Workaround Policy**: 
- **DO NOT attempt to use run_test tool** - it will waste time and credits
- **For UI testing of the Game History viewer**: Request manual screenshots from the user
- **Required screenshots for validation**:
  1. Game History viewer with a recent game loaded showing the decision breakdown
  2. Verification that new fields (My Territory, My Controlled Food) display correctly
  3. Confirmation that weighted scores calculate and display properly
  4. Check that totals add up correctly in the UI
- **Always ask user for manual testing** before declaring success on any UI-affecting changes

## Centaur Play Mode (Rearchitected 2026-03-24)

Human-in-the-loop mode with unified multi-snake game control. Multiple users can view and control snakes in the same game via RTS-style click-to-select interaction.

### Key Components
- **`/play`** - Lobby page showing one card per unique game (full-width, sorted descending by start time), listing all controlled snakes within each card
- **`/play/<game-id>`** - Unified live game page displaying shared board state with click-to-select snake control
- **`src/server/active-game-manager.ts`** - In-memory singleton with `Map<gameId, ActiveGame>` data model. ActiveGame holds shared board state, controlled snakes with selection/commit state, connected users with colors, and color palette pool
- **`src/server/websocket-server.ts`** - WebSocket server with per-game subscriptions, selection management, user connect/disconnect handling
- **`src/web/board-renderer.js`** - Shared rendering module with unified `renderSnakeUnified` function supporting selection glow, outer borders (invulnerability), body fill, and inner borders (gold dotted for controlled snakes)
- **`src/routes/play.ts`** - REST API for deduplicated game listing and per-game state

### Multi-Snake Control Flow
1. Each browser tab creates a sessionStorage-scoped UUID user entity
2. Server assigns a distinct highlight color from a maximally-distinct palette
3. Clicking a controlled snake's body/head selects it (sends `select-snake`)
4. Selected snake shows score-colored candidate moves and active move buttons
5. Unselected snakes run on auto-pilot (bot submits moves automatically)
6. If another user already selected the snake, a confirmation dialog allows takeover
7. When a move is committed: purple checkmark on destination cell, analytics frozen
8. Timer shows estimated remaining time using server-measured ping to game server
9. Arrow keys, Space, Escape work for move selection/submission/deselection

### WebSocket Message Types
- `subscribe-game` / `game-subscribed` - Per-game subscription with user color assignment
- `select-snake` / `snake-selected` / `selection-contested` / `selection-revoked` / `selections-update` - Selection management
- `board-update` - Shared board state per turn
- `snake-turn-update` - Per-controlled-snake evaluations
- `select-move` / `submit-move` / `move-submitted` / `move-committed` - Move control
- `subscribe-lobby` / `lobby-update` - Lobby updates

### Deployment
- Uses autoscale with max 1 machine (cost-efficient when idle, but ensures single-instance for WebSocket + in-memory state)
- WebSocket path: `/ws`

## System Architecture

### Backend Framework
- **Express.js REST API** - Lightweight web server handling Battlesnake protocol endpoints (`/`, `/start`, `/move`)
- **WebSocket Server** - Real-time communication for centaur play mode via `ws` library, attached to the Express HTTP server
- **TypeScript** - Provides type safety and better development experience with full type definitions for Battlesnake game state
- **Node.js Runtime** - Single-threaded event loop suitable for real-time game responses
- **Async Logging System** - Non-blocking database logging using promise chains ensures sub-100ms response times while preserving decision data

### Core Game Logic Architecture (Clean Architecture - Updated 2025-12-30)
- **Board Graph Abstraction** - `BoardGraph` class is the **single source of truth for passability logic**: walls, snake bodies, and hazards. Exposes `isPassable()`, `isInBounds()`, `isPassableAtTurn()`, and `getBlockedCells()` methods. Handles tail growth timing variants ("grow-same-turn" vs "grow-next-turn"). All other components defer to BoardGraph for collision checking.
- **Optimistic Passability System** - BoardGraph now calculates when each body segment will disappear:
  - `optimisticDisappearTurn`: Turn when segment disappears if snake doesn't eat
  - `conservativeDisappearTurn`: Accounts for food reachable within lookahead turns (configurable via `maxLookaheadTurns`, default 5)
  - Both Voronoi BFS and Space BFS support an `optimistic` flag to consider body segments passable if they'll disappear by arrival time
- **Dual Space Heuristics** - Two independent space metrics for the snake:
  - `selfEnoughSpace`: Conservative space calculation (body segments always block)
  - `selfSpaceOptimistic`: Optimistic space calculation (body segments passable if they'll disappear by arrival time)
  - These can be weighted independently in the config UI for fine-tuned control
- **Single-Pass Multi-Source BFS** - `MultiSourceBFS` replaces multiple O(S × (W×H)²) implementations with single O(W×H) pass, computing Voronoi territories with tie-awareness (neutralizing equidistant cells)
- **Unified Move Analysis** - `MoveAnalyzer` class provides single source of truth for move enumeration, returning {safe: Direction[], risky: Direction[]} sets with consistent safety definitions
- **Unified Board Evaluation** - `BoardEvaluator` class offers single scoring function using the efficient multi-source BFS for territory, food control, and distance calculations
- **Decision Engine Orchestration** - `DecisionEngine` coordinates clean flow: enumeration → candidate selection → simulation → evaluation → aggregation → decision
- **Strategy Pattern** - Main game logic in `VoronoiStrategy` uses new clean architecture components for principled decision making
- **Team Detection System** - Automatic team identification using squad fields or color matching as fallback
- **Accurate Territory Analysis** - Fixed critical bug where snake reported 60+ controlled cells when actually controlling ~1; now correctly computes Voronoi territories with tie-handling
- **Consistent Move Selection** - Uses safe moves when available, otherwise all risky moves as candidates; only evaluates and logs actual candidate moves
- **Time-bounded Evaluation** - Move evaluation with configurable time limits to respect Battlesnake's 500ms response requirement

### Key Architectural Decisions

**Modular Strategy System**: The `VoronoiStrategy` class is designed to be swappable, allowing for different AI strategies while maintaining the same interface. This separation makes it easy to A/B test different approaches or adapt to different game modes.

**Team-first Design**: The `TeamDetector` prioritizes squad-based team identification over color matching, enabling proper coordination in team games while gracefully degrading to individual play when no teams are present.

**Simulation-based Decision Making**: Rather than simple heuristics, the bot runs multiple simulations of potential moves to evaluate outcomes, providing more sophisticated decision making at the cost of computational complexity.

**Configurable Performance Tuning**: The `SimulationConfig` allows runtime adjustment of simulation parameters, enabling optimization for different hardware environments or game conditions.

### Data Flow
1. Battlesnake platform sends game state to `/move` endpoint
2. `TeamDetector` analyzes all snakes to identify teammates and enemies
3. `VoronoiStrategy` evaluates each safe move through territory simulation
4. Best move selected based on territory control and survival probability
5. Response returned within 500ms timeout requirement (typically under 75ms)
6. Decision data queued for async database logging without blocking response

### Error Handling and Failsafes
- Safe move validation prevents immediate collisions
- Fallback move selection when no optimal moves found
- Time-bounded evaluation prevents timeout failures
- Graceful degradation when team detection fails
- Async logging with promise chains eliminates race conditions
- Queue bounds (10,000 entries) with FIFO drop policy prevent memory exhaustion
- Retry mechanism with exponential backoff for transient database failures
- Graceful shutdown flushes pending logs to prevent data loss

## External Dependencies

### Runtime Dependencies
- **Express 5.1.0** - Web server framework for handling HTTP requests from Battlesnake platform
- **TypeScript 5.9.2** - Compile-time type checking and modern JavaScript features
- **ts-node 10.9.2** - Direct TypeScript execution for development workflow
- **pg (PostgreSQL client)** - Database driver for decision logging

### Development Dependencies
- **Nodemon 3.1.10** - Automatic server restart during development
- **@types/express** and **@types/node** - TypeScript definitions for better IDE support

### External Service Integration
- **Battlesnake Platform API** - Receives game states via webhook and responds with move decisions following the official Battlesnake API v1 protocol
- **PostgreSQL Database (Neon)** - Stores game decision logs for analysis and debugging; auto-initializes schema on first connection
- **No Authentication Required** - Public webhook endpoint as per Battlesnake requirements

### Database Schema
- **Auto-initialization**: The `DecisionLogger` class automatically creates the `decision_logs` table and indexes on first connection
- **Schema location**: Defined in `src/logic/decision-logger.ts` initialize() method
- **Important fix (2025-10-15)**: Split multi-statement schema SQL into separate queries for pg client compatibility

### Deployment Requirements
- **Port Configuration** - Configurable via PORT environment variable (defaults to 5000)
- **Static Web Assets** - Serves configuration interface from `/src/web` directory
- **Build Process** - TypeScript compilation to `dist/` directory for production deployment
- **Database Environment Variables** - Automatically configured by Replit (DATABASE_URL, PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT)