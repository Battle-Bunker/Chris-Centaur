# Team Snek Bot - Battlesnake AI

## Overview

Team Snek Bot is a TypeScript-based Battlesnake AI that implements a sophisticated team-based strategy using Voronoi territory analysis. The bot is designed to compete in a **custom Battlesnake engine that allows both human players and AI bots to compete in the same game** - a unique testing environment where humans can directly challenge and analyze bot behavior. The bot uses team-based coordination (when teams are present) and focuses on maximizing controlled territory through Voronoi diagrams while avoiding fatal collisions, particularly head-to-head encounters with larger snakes.

## User Preferences

Preferred communication style: Simple, everyday language.

## Critical System Synchronization Notes

**IMPORTANT: When making changes to the Battlesnake AI system, ensure ALL components remain synchronized:**

1. **Backend-Frontend Data Flow**: Changes to data structures in the backend (board-evaluator.ts, decision-engine.ts, voronoi-strategy-new.ts) MUST be reflected in:
   - Decision logger database schema (decision-logger.ts)
   - Frontend UI display logic (src/web/history.html)
   - Any API response formats

2. **Field Name Changes**: If renaming or restructuring fields (e.g., fertileTerritory → myTerritory + myControlledFood):
   - Update TypeScript interfaces in ALL files
   - Update database logging to use new field names
   - Update frontend JavaScript to read and display new field names
   - Ensure backward compatibility for existing logged data

3. **Testing Must Be End-to-End**: 
   - Don't just check console logs or API responses
   - ALWAYS open the Game History viewer UI to verify changes are displayed correctly
   - Test with actual game data from the database, not just curl commands

4. **Common Failure Points**:
   - Frontend UI still using old field names while backend uses new ones
   - Weighted score calculations not matching between backend and frontend
   - Database schema out of sync with logged data structure
   - Total scores not adding up correctly in the UI

Remember: A change isn't complete until it works in the user-facing UI, not just in the logs!

## System Architecture

### Backend Framework
- **Express.js REST API** - Lightweight web server handling Battlesnake protocol endpoints (`/`, `/start`, `/move`)
- **TypeScript** - Provides type safety and better development experience with full type definitions for Battlesnake game state
- **Node.js Runtime** - Single-threaded event loop suitable for real-time game responses
- **Async Logging System** - Non-blocking database logging using promise chains ensures sub-100ms response times while preserving decision data

### Core Game Logic Architecture (Clean Architecture - Updated 2025-09-19)
- **Unified Move Analysis** - `MoveAnalyzer` class provides single source of truth for move enumeration, returning {safe: Direction[], risky: Direction[]} sets with consistent safety definitions
- **Unified Board Evaluation** - `BoardEvaluator` class offers single scoring function with structured statistics (fertile territory, team length, food distance, enemy stats, kills/deaths)
- **Decision Engine Orchestration** - `DecisionEngine` coordinates clean flow: enumeration → candidate selection → simulation → evaluation → aggregation → decision
- **Strategy Pattern** - Main game logic in `VoronoiStrategy` uses new clean architecture components for principled decision making
- **Team Detection System** - Automatic team identification using squad fields or color matching as fallback
- **Fertile Voronoi Territory Analysis** - Enhanced Voronoi diagram calculations that weight food-controlled territories higher (territory + food × 10) to prioritize areas with resources
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

### Development Dependencies
- **Nodemon 3.1.10** - Automatic server restart during development
- **@types/express** and **@types/node** - TypeScript definitions for better IDE support

### External Service Integration
- **Battlesnake Platform API** - Receives game states via webhook and responds with move decisions following the official Battlesnake API v1 protocol
- **No Database Required** - Stateless design processes each game turn independently
- **No Authentication Required** - Public webhook endpoint as per Battlesnake requirements

### Deployment Requirements
- **Port Configuration** - Configurable via PORT environment variable (defaults to 5000)
- **Static Web Assets** - Serves configuration interface from `/src/web` directory
- **Build Process** - TypeScript compilation to `dist/` directory for production deployment