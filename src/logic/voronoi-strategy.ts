/**
 * Compatibility module that re-exports VoronoiStrategy from the new implementation.
 * This file exists to maintain backwards compatibility with existing test files
 * and other imports that expect the strategy to be available at this path.
 */

export { VoronoiStrategy } from './voronoi-strategy-new';