"use strict";
/**
 * Compatibility module that re-exports VoronoiStrategy from the new implementation.
 * This file exists to maintain backwards compatibility with existing test files
 * and other imports that expect the strategy to be available at this path.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoronoiStrategy = void 0;
var voronoi_strategy_new_1 = require("./voronoi-strategy-new");
Object.defineProperty(exports, "VoronoiStrategy", { enumerable: true, get: function () { return voronoi_strategy_new_1.VoronoiStrategy; } });
