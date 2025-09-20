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
  closestSourceId: string | null;  // null for neutral/tied cells
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
   * Handles ties by marking equidistant cells as neutral.
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
    
    // Use array-based queue with head pointer for O(1) dequeue
    const queue: QueueItem[] = [];
    let queueHead = 0;
    
    // Track cells that have been reached but might be tied
    const reachedCells = new Map<CellKey, { sourceId: string, distance: number }>();
    
    // Add all sources to queue
    for (const source of sources) {
      const key = this.graph.coordToKey(source.position);
      queue.push({
        position: source.position,
        sourceId: source.id,
        distance: 0
      });
      
      // Mark source position as owned by this source
      cellInfo.set(key, {
        closestSourceId: source.id,
        distance: 0
      });
      
      reachedCells.set(key, { sourceId: source.id, distance: 0 });
      
      // Count this cell for territory
      territoryCounts.set(source.id, territoryCounts.get(source.id)! + 1);
      
      // Check if source is on food
      if (foodSet.has(key)) {
        controlledFood.set(source.id, controlledFood.get(source.id)! + 1);
        nearestFoodDistance.set(source.id, 0);
      }
    }
    
    // Process BFS queue
    while (queueHead < queue.length) {
      const current = queue[queueHead++];
      
      // Check if current cell has been neutralized - if so, don't expand from it
      const currentKey = this.graph.coordToKey(current.position);
      const currentCellInfo = cellInfo.get(currentKey);
      if (currentCellInfo && currentCellInfo.closestSourceId === null) {
        // This cell was neutralized, don't expand from it
        continue;
      }
      
      // Also skip if this cell is now owned by a different source (shouldn't happen but be safe)
      if (currentCellInfo && currentCellInfo.closestSourceId !== current.sourceId) {
        continue;
      }
      
      // Get passable neighbors
      const neighbors = this.graph.getNeighbors(current.position);
      
      for (const neighbor of neighbors) {
        const neighborKey = this.graph.coordToKey(neighbor);
        const newDistance = current.distance + 1;
        
        // Check if this cell has been reached before
        const previousReach = reachedCells.get(neighborKey);
        
        if (previousReach) {
          // Cell was reached before - check for tie
          if (previousReach.distance === newDistance && previousReach.sourceId !== current.sourceId) {
            // Tie detected! Mark as neutral if not already
            const existingInfo = cellInfo.get(neighborKey);
            if (existingInfo && existingInfo.closestSourceId !== null) {
              // Was owned by someone, now neutral
              const previousOwner = existingInfo.closestSourceId;
              
              // Decrement territory count for previous owner
              territoryCounts.set(previousOwner, territoryCounts.get(previousOwner)! - 1);
              
              // If this cell had food, decrement food count for previous owner
              if (foodSet.has(neighborKey)) {
                controlledFood.set(previousOwner, controlledFood.get(previousOwner)! - 1);
              }
              
              // Mark as neutral
              cellInfo.set(neighborKey, {
                closestSourceId: null,
                distance: newDistance
              });
            }
          }
          // If already reached at shorter distance or already neutral, skip
          continue;
        }
        
        // First time reaching this cell
        reachedCells.set(neighborKey, { sourceId: current.sourceId, distance: newDistance });
        
        // Record cell info
        cellInfo.set(neighborKey, {
          closestSourceId: current.sourceId,
          distance: newDistance
        });
        
        // Update territory count
        territoryCounts.set(current.sourceId, territoryCounts.get(current.sourceId)! + 1);
        
        // Check if this cell has food
        if (foodSet.has(neighborKey)) {
          controlledFood.set(current.sourceId, controlledFood.get(current.sourceId)! + 1);
          
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
      return 1000;
    }
    
    return info.distance;
  }
}