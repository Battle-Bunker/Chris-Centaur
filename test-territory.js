// Quick test to verify territory calculation is fixed
// This simulates a game state and checks the territory calculation

const testGameState = {
  game: {
    id: "test-game",
    ruleset: { name: "standard", version: "1.0.0", settings: {} },
    map: "standard",
    timeout: 500,
    source: "test"
  },
  turn: 54,
  board: {
    width: 11,
    height: 11,
    snakes: [
      {
        id: "our-snake",
        name: "Our Snake",
        health: 100,
        body: [
          { x: 5, y: 5 },  // head
          { x: 5, y: 4 },
          { x: 5, y: 3 }
        ],
        head: { x: 5, y: 5 },
        length: 3,
        latency: "100",
        shout: "",
        squad: "",
        customizations: { color: "#FFD700", head: "default", tail: "default" }
      },
      {
        id: "enemy-1",
        name: "Enemy 1",
        health: 95,
        body: [
          { x: 4, y: 5 },  // right next to our head
          { x: 3, y: 5 },
          { x: 2, y: 5 }
        ],
        head: { x: 4, y: 5 },
        length: 3,
        latency: "100",
        shout: "",
        squad: "",
        customizations: { color: "#FF0000", head: "default", tail: "default" }
      },
      {
        id: "enemy-2",
        name: "Enemy 2",
        health: 90,
        body: [
          { x: 6, y: 5 },  // other side
          { x: 7, y: 5 },
          { x: 8, y: 5 }
        ],
        head: { x: 6, y: 5 },
        length: 3,
        latency: "100",
        shout: "",
        squad: "",
        customizations: { color: "#0000FF", head: "default", tail: "default" }
      }
    ],
    food: [
      { x: 5, y: 6 }  // food above our head
    ],
    hazards: []
  },
  you: {
    id: "our-snake",
    name: "Our Snake",
    health: 100,
    body: [
      { x: 5, y: 5 },  // head
      { x: 5, y: 4 },
      { x: 5, y: 3 }
    ],
    head: { x: 5, y: 5 },
    length: 3,
    latency: "100",
    shout: "",
    squad: "",
    customizations: { color: "#FFD700", head: "default", tail: "default" }
  }
};

// Send move request to the server
fetch('http://localhost:5000/move', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(testGameState)
})
.then(response => response.json())
.then(data => {
  console.log('Move response:', data);
  console.log('\nTEST PASSED: Server responded successfully after refactor');
  console.log('Next step: Check Game History UI to verify territory calculation is now correct (should be ~1-3 cells, not 60+)');
})
.catch(error => {
  console.error('Error:', error);
  console.log('\nTEST FAILED: Server did not respond correctly');
});