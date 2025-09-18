"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamDetector = void 0;
class TeamDetector {
    detectTeams(snakes) {
        const teamMap = new Map();
        // Group snakes by team identifier (squad first, then color fallback)
        for (const snake of snakes) {
            const teamKey = this.getTeamKey(snake);
            if (!teamMap.has(teamKey)) {
                teamMap.set(teamKey, []);
            }
            teamMap.get(teamKey).push(snake);
        }
        // Create TeamInfo objects
        const teams = [];
        for (const [teamKey, teamSnakes] of teamMap) {
            const totalLength = teamSnakes.reduce((sum, snake) => sum + snake.length, 0);
            teams.push({
                color: teamKey, // This represents the team identifier (squad or color)
                snakes: teamSnakes,
                totalLength
            });
        }
        return teams;
    }
    getTeammates(snake, allSnakes) {
        const myTeamKey = this.getTeamKey(snake);
        return allSnakes.filter(s => s.id !== snake.id &&
            this.getTeamKey(s) === myTeamKey);
    }
    getEnemySnakes(snake, allSnakes) {
        const myTeamKey = this.getTeamKey(snake);
        return allSnakes.filter(s => this.getTeamKey(s) !== myTeamKey);
    }
    getTeamKey(snake) {
        // Use squad field for team detection, fallback to color, then to snake ID
        return snake.squad || snake.customizations?.color || snake.id;
    }
}
exports.TeamDetector = TeamDetector;
//# sourceMappingURL=team-detector.js.map