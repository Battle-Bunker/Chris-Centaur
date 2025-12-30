/**
 * Multi-source BFS implementation for efficient board analysis.
 * Computes voronoi territories, distances, and food control in a single pass.
 * Processes cells level-by-level to properly detect ties.
 * Supports optimistic passability for body segments.
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
  
  // Territory cells per source (actual coordinates)
  territoryCells: Map<string, Coord[]>;
  
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

export interface BFSOptions {
  optimistic: boolean;
}

export class MultiSourceBFS {
  private graph: BoardGraph;
  
  constructor(graph: BoardGraph) {
    this.graph = graph;
  }
  
  /**
   * Run multi-source BFS from all snake heads in a single pass.
   * O(W×H) complexity - each cell visited at most once.
   * Processes level-by-level to properly handle ties.
   * 
   * @param sources - BFS starting points (snake heads)
   * @param foodPositions - Food locations on the board
   * @param options - BFS options including optimistic passability
   */
  compute(sources: BFSSource[], foodPositions: Coord[], options?: BFSOptions): BFSResult {
    const useOptimistic = options?.optimistic ?? false;
    
    // Initialize result structure
    const cellInfo = new Map<CellKey, CellInfo>();
    const territoryCounts = new Map<string, number>();
    const territoryCells = new Map<string, Coord[]>();
    const controlledFood = new Map<string, number>();
    const nearestFoodDistance = new Map<string, number>();
    
    // Initialize counters
    for (const source of sources) {
      territoryCounts.set(source.id, 0);
      territoryCells.set(source.id, []);
      controlledFood.set(source.id, 0);
      nearestFoodDistance.set(source.id, Infinity);
    }
    
    // Create food position set for quick lookup
    const foodSet = new Set<CellKey>(
      foodPositions.map(f => this.graph.coordToKey(f))
    );
    
    // Process BFS level by level for proper tie detection
    interface QueueItem {
      position: Coord;
      sourceId: string;
    }
    
    // Current level being processed
    let currentLevel: QueueItem[] = [];
    let nextLevel: QueueItem[] = [];
    let currentDistance = 0;
    
    // Initialize with source positions
    for (const source of sources) {
      currentLevel.push({
        position: source.position,
        sourceId: source.id
      });
    }
    
    // Process all levels
    while (currentLevel.length > 0) {
      // Track cells reached at this distance by each source (using Set to deduplicate)
      const cellsReachedThisLevel = new Map<CellKey, Set<string>>();
      
      // First pass: identify all cells reached at this distance
      for (const item of currentLevel) {
        const key = this.graph.coordToKey(item.position);
        
        // For distance 0 (sources), directly add to cellInfo
        if (currentDistance === 0) {
          cellInfo.set(key, {
            closestSourceId: item.sourceId,
            distance: 0
          });
          territoryCounts.set(item.sourceId, 1);
          territoryCells.get(item.sourceId)!.push({ x: item.position.x, y: item.position.y });
          
          // Check if source is on food
          if (foodSet.has(key)) {
            controlledFood.set(item.sourceId, controlledFood.get(item.sourceId)! + 1);
            nearestFoodDistance.set(item.sourceId, 0);
          }
        } else {
          // For distance > 0, track which sources reach this cell (deduplicated)
          if (!cellsReachedThisLevel.has(key)) {
            cellsReachedThisLevel.set(key, new Set<string>());
          }
          cellsReachedThisLevel.get(key)!.add(item.sourceId);
        }
      }
      
      // Second pass: assign ownership or mark as neutral for cells at this distance
      for (const [cellKey, sourceIdSet] of cellsReachedThisLevel) {
        // Skip if already visited (shouldn't happen but be safe)
        if (cellInfo.has(cellKey)) {
          continue;
        }
        
        // Convert Set to array for easier handling
        const sourceIds = Array.from(sourceIdSet);
        
        if (sourceIds.length === 1) {
          // Single source reaches this cell - it owns it
          const sourceId = sourceIds[0];
          cellInfo.set(cellKey, {
            closestSourceId: sourceId,
            distance: currentDistance
          });
          
          // Update territory count and cells
          territoryCounts.set(sourceId, territoryCounts.get(sourceId)! + 1);
          const cellCoord = this.graph.keyToCoord(cellKey);
          territoryCells.get(sourceId)!.push(cellCoord);
          
          // Check if this cell has food
          if (foodSet.has(cellKey)) {
            controlledFood.set(sourceId, controlledFood.get(sourceId)! + 1);
            
            // Update nearest food distance
            const currentNearestFood = nearestFoodDistance.get(sourceId)!;
            if (currentDistance < currentNearestFood) {
              nearestFoodDistance.set(sourceId, currentDistance);
            }
          }
        } else {
          // Multiple sources reach this cell at same distance - it's neutral
          cellInfo.set(cellKey, {
            closestSourceId: null,
            distance: currentDistance
          });
          
          // Still update nearest food distance for all sources that can reach it
          if (foodSet.has(cellKey)) {
            for (const sourceId of sourceIds) {
              const currentNearestFood = nearestFoodDistance.get(sourceId)!;
              if (currentDistance < currentNearestFood) {
                nearestFoodDistance.set(sourceId, currentDistance);
              }
            }
          }
        }
      }
      
      // Third pass: explore neighbors for next level
      // Only explore from cells that are owned (not neutral)
      for (const item of currentLevel) {
        const key = this.graph.coordToKey(item.position);
        const info = cellInfo.get(key);
        
        // Skip if this cell is neutral or owned by different source
        if (!info || info.closestSourceId !== item.sourceId) {
          continue;
        }
        
        // Get passable neighbors - use optimistic if enabled
        // The arrival turn is currentDistance + 1 (next level)
        const arrivalTurn = currentDistance + 1;
        const neighbors = useOptimistic 
          ? this.graph.getNeighborsOptimistic(item.position, arrivalTurn)
          : this.graph.getNeighbors(item.position);
        
        for (const neighbor of neighbors) {
          const neighborKey = this.graph.coordToKey(neighbor);
          
          // Skip if already visited
          if (cellInfo.has(neighborKey)) {
            continue;
          }
          
          // Add to next level
          nextLevel.push({
            position: neighbor,
            sourceId: item.sourceId
          });
        }
      }
      
      // Move to next level
      currentLevel = nextLevel;
      nextLevel = [];
      currentDistance++;
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
      territoryCells,
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
