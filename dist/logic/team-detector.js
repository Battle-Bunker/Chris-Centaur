"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamDetector = void 0;
class TeamDetector {
    detectTeams(snakes) {
        const teamMap = new Map();
        // Group snakes by color to form teams
        for (const snake of snakes) {
            const color = snake.customizations.color;
            if (!teamMap.has(color)) {
                teamMap.set(color, []);
            }
            teamMap.get(color).push(snake);
        }
        // Create TeamInfo objects
        const teams = [];
        for (const [color, teamSnakes] of teamMap) {
            const totalLength = teamSnakes.reduce((sum, snake) => sum + snake.length, 0);
            teams.push({
                color,
                snakes: teamSnakes,
                totalLength
            });
        }
        return teams;
    }
    getTeammates(snake, allSnakes) {
        const myColor = snake.customizations.color;
        return allSnakes.filter(s => s.id !== snake.id &&
            s.customizations.color === myColor);
    }
    getEnemySnakes(snake, allSnakes) {
        const myColor = snake.customizations.color;
        return allSnakes.filter(s => s.customizations.color !== myColor);
    }
}
exports.TeamDetector = TeamDetector;
//# sourceMappingURL=team-detector.js.map