# Team Snek Bot - Battlesnake AI

## Overview

Team Snek Bot is a TypeScript-based Battlesnake AI that implements a sophisticated team-based strategy using Voronoi territory analysis. The bot is designed to compete in Battlesnake games where multiple snakes can form teams and work together to control territory and eliminate opponents. The core strategy focuses on maximizing controlled territory through Voronoi diagrams while coordinating with teammates and avoiding collisions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Framework
- **Express.js REST API** - Lightweight web server handling Battlesnake protocol endpoints (`/`, `/start`, `/move`)
- **TypeScript** - Provides type safety and better development experience with full type definitions for Battlesnake game state
- **Node.js Runtime** - Single-threaded event loop suitable for real-time game responses

### Core Game Logic Architecture
- **Strategy Pattern** - Main game logic separated into pluggable strategy classes, currently implementing `VoronoiStrategy`
- **Team Detection System** - Automatic team identification using squad fields or color matching as fallback
- **Territory Analysis** - Voronoi diagram calculations to determine controlled territory and optimal move selection
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
5. Response returned within 500ms timeout requirement

### Error Handling and Failsafes
- Safe move validation prevents immediate collisions
- Fallback move selection when no optimal moves found
- Time-bounded evaluation prevents timeout failures
- Graceful degradation when team detection fails

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