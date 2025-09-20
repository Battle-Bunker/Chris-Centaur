/**
 * Multi-source BFS implementation for efficient board analysis.
 * Computes voronoi territories, distances, and food control in a single pass.
 */

import { Coord } from '../types/battlesnake';
import { BoardGraph, CellKey } from './board-graph';

export interface BFSSource {
  id: string;
  position: Coord;
  isTeam: boolean;
}

export interface CellInfo {
  closestSourceId: string;
  distance: number;
}

export interface BFSResult {
  // Map from cell key to info about that cell
  cellInfo: Map<CellKey, CellInfo>;
  
  // Territory counts per source
  territoryCounts: Map<string, number>;
  
  // Controlled food counts per source
  controlledFood: Map<string, number>;
  
  // Nearest food distance per source
  nearestFoodDistance: Map<string, number>;
  
  // Team aggregates
  teamTerritory: number;
  teamControlledFood: number;
  enemyTerritory: number;
  enemyControlledFood: number;
}

export class MultiSourceBFS {
  private graph: BoardGraph;
  
  constructor(graph: BoardGraph) {
    this.graph = graph;
  }
  
  /**
   * Run multi-source BFS from all snake heads in a single pass.
   * O(W×H) complexity - each cell visited at most once.
   */
  compute(sources: BFSSource[], foodPositions: Coord[]): BFSResult {
    // Initialize result structure
    const cellInfo = new Map<CellKey, CellInfo>();
    const territoryCounts = new Map<string, number>();
    const controlledFood = new Map<string, number>();
    const nearestFoodDistance = new Map<string, number>();
    
    // Initialize counters
    for (const source of sources) {
      territoryCounts.set(source.id, 0);
      controlledFood.set(source.id, 0);
      nearestFoodDistance.set(source.id, Infinity);
    }
    
    // Create food position set for quick lookup
    const foodSet = new Set<CellKey>(
      foodPositions.map(f => this.graph.coordToKey(f))
    );
    
    // Initialize BFS queue with all sources
    interface QueueItem {
      position: Coord;
      sourceId: string;
      distance: number;
    }
    
    const queue: QueueItem[] = [];
    const visited = new Set<CellKey>();
    
    // Add all sources to queue
    for (const source of sources) {
      const key = this.graph.coordToKey(source.position);
      queue.push({
        position: source.position,
        sourceId: source.id,
        distance: 0
      });
      
      // Mark source position as visited and owned by this source
      visited.add(key);
      cellInfo.set(key, {
        closestSourceId: source.id,
        distance: 0
      });
      
      // Count this cell for territory
      territoryCounts.set(source.id, territoryCounts.get(source.id)! + 1);
      
      // Check if source is on food
      if (foodSet.has(key)) {
        controlledFood.set(source.id, controlledFood.get(source.id)! + 1);
        nearestFoodDistance.set(source.id, 0);
      }
    }
    
    // Process BFS queue
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      // Get passable neighbors
      const neighbors = this.graph.getNeighbors(current.position);
      
      for (const neighbor of neighbors) {
        const neighborKey = this.graph.coordToKey(neighbor);
        
        // Skip if already visited (another source got there first)
        if (visited.has(neighborKey)) {
          continue;
        }
        
        // Mark as visited
        visited.add(neighborKey);
        
        // Record cell info
        const newDistance = current.distance + 1;
        cellInfo.set(neighborKey, {
          closestSourceId: current.sourceId,
          distance: newDistance
        });
        
        // Update territory count
        const currentCount = territoryCounts.get(current.sourceId)!;
        territoryCounts.set(current.sourceId, currentCount + 1);
        
        // Check if this cell has food
        if (foodSet.has(neighborKey)) {
          const currentFoodCount = controlledFood.get(current.sourceId)!;
          controlledFood.set(current.sourceId, currentFoodCount + 1);
          
          // Update nearest food distance if this is closer
          const currentNearestFood = nearestFoodDistance.get(current.sourceId)!;
          if (newDistance < currentNearestFood) {
            nearestFoodDistance.set(current.sourceId, newDistance);
          }
        }
        
        // Add to queue to explore further
        queue.push({
          position: neighbor,
          sourceId: current.sourceId,
          distance: newDistance
        });
      }
    }
    
    // Calculate team aggregates
    let teamTerritory = 0;
    let teamControlledFood = 0;
    let enemyTerritory = 0;
    let enemyControlledFood = 0;
    
    for (const source of sources) {
      const territory = territoryCounts.get(source.id)!;
      const food = controlledFood.get(source.id)!;
      
      if (source.isTeam) {
        teamTerritory += territory;
        teamControlledFood += food;
      } else {
        enemyTerritory += territory;
        enemyControlledFood += food;
      }
    }
    
    // Convert Infinity to 1000 for consistency with old code
    for (const [id, distance] of nearestFoodDistance) {
      if (distance === Infinity) {
        nearestFoodDistance.set(id, 1000);
      }
    }
    
    return {
      cellInfo,
      territoryCounts,
      controlledFood,
      nearestFoodDistance,
      teamTerritory,
      teamControlledFood,
      enemyTerritory,
      enemyControlledFood
    };
  }
  
  /**
   * Get distance from a specific source to a specific position.
   * Returns 1000 if unreachable.
   */
  getDistance(result: BFSResult, sourceId: string, position: Coord): number {
    const key = this.graph.coordToKey(position);
    const info = result.cellInfo.get(key);
    
    if (!info || info.closestSourceId !== sourceId) {
      // This cell is not reachable by this source or is closer to another source
      // We need to check if it's reachable at all by doing a single-source BFS
      // For now, return 1000 (unreachable) for simplicity
      return 1000;
    }
    
    return info.distance;
  }
}