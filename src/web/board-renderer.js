const BoardRenderer = (function() {
  let _potionImage = null;
  let _potionImageLoading = false;

  function loadPotionImage() {
    if (_potionImage || _potionImageLoading) return;
    _potionImageLoading = true;
    const img = new Image();
    img.onload = () => { _potionImage = img; };
    img.onerror = () => { _potionImageLoading = false; };
    img.src = '/invulnerability-potion.png';
  }

  if (typeof window !== 'undefined') {
    loadPotionImage();
  }

  function hexToRgba(hex, alpha) {
    let color = hex;
    if (!color || typeof color !== 'string') {
      return `rgba(136, 136, 136, ${alpha})`;
    }
    color = color.replace('#', '');
    if (color.length === 3) {
      color = color.split('').map(c => c + c).join('');
    }
    const r = parseInt(color.substring(0, 2), 16) || 136;
    const g = parseInt(color.substring(2, 4), 16) || 136;
    const b = parseInt(color.substring(4, 6), 16) || 136;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function getMoveQuality(score, allScores) {
    if (score == null || allScores.length === 0) return 'not-evaluated';
    const maxScore = Math.max(...allScores);
    const minScore = Math.min(...allScores);
    const range = maxScore - minScore;
    if (range === 0) return 'neutral';
    const normalized = (score - minScore) / range;
    if (normalized >= 0.8) return 'best';
    if (normalized >= 0.5) return 'good';
    if (normalized >= 0.2) return 'neutral';
    return 'bad';
  }

  function getScoreColor(score, allScores) {
    if (score == null || allScores.length === 0) return 'rgba(100, 100, 100, 0.3)';
    const maxScore = Math.max(...allScores);
    const minScore = Math.min(...allScores);
    const range = maxScore - minScore;
    if (range === 0 || allScores.length === 1) {
      const hue = score > 0 ? 90 : (score < 0 ? 0 : 60);
      return `hsla(${hue}, 70%, 50%, 0.3)`;
    }
    const normalized = (score - minScore) / range;
    const hue = normalized * 120;
    return `hsla(${hue}, 70%, 50%, 0.3)`;
  }

  function hexToRgb(hex) {
    let color = hex || '#888888';
    color = color.replace('#', '');
    if (color.length === 3) color = color.split('').map(c => c + c).join('');
    return {
      r: parseInt(color.substring(0, 2), 16) || 136,
      g: parseInt(color.substring(2, 4), 16) || 136,
      b: parseInt(color.substring(4, 6), 16) || 136
    };
  }

  function renderTerritoryBoundaries(ctx, territoryCells, snakeColorMap, boardHeight, cellSize, selectedSnake, bodyOwnerMap) {
    const ownerMap = {};
    Object.entries(territoryCells).forEach(([sid, cells]) => {
      if (!cells || cells.length === 0) return;
      cells.forEach(cell => {
        ownerMap[`${cell.x},${cell.y}`] = sid;
      });
    });

    function shouldDrawBoundary(sid, nx, ny) {
      const nk = `${nx},${ny}`;
      if (ownerMap[nk] === sid) return false;
      if (bodyOwnerMap && bodyOwnerMap[nk] === sid) return false;
      return true;
    }

    const glowDepth = Math.max(4, Math.floor(cellSize * 0.4));
    const lineWidth = Math.max(1.5, cellSize * 0.06);

    Object.entries(territoryCells).forEach(([sid, cells]) => {
      if (!cells || cells.length === 0) return;
      const snakeColor = snakeColorMap[sid] || '#888888';
      const rgb = hexToRgb(snakeColor);
      const glowAlpha = (selectedSnake === sid) ? 0.6 : 0.45;

      cells.forEach(cell => {
        const px = cell.x * cellSize;
        const py = (boardHeight - 1 - cell.y) * cellSize;

        const edges = [
          { dx: 0, dy: 1, dir: 'top' },
          { dx: 0, dy: -1, dir: 'bottom' },
          { dx: -1, dy: 0, dir: 'left' },
          { dx: 1, dy: 0, dir: 'right' }
        ];

        edges.forEach(({ dx, dy, dir }) => {
          if (!shouldDrawBoundary(sid, cell.x + dx, cell.y + dy)) return;
          let grad;
          switch (dir) {
            case 'top':
              grad = ctx.createLinearGradient(px, py, px, py + glowDepth);
              grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`);
              grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
              ctx.fillStyle = grad;
              ctx.fillRect(px, py, cellSize, glowDepth);
              break;
            case 'bottom':
              grad = ctx.createLinearGradient(px, py + cellSize, px, py + cellSize - glowDepth);
              grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`);
              grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
              ctx.fillStyle = grad;
              ctx.fillRect(px, py + cellSize - glowDepth, cellSize, glowDepth);
              break;
            case 'left':
              grad = ctx.createLinearGradient(px, py, px + glowDepth, py);
              grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`);
              grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
              ctx.fillStyle = grad;
              ctx.fillRect(px, py, glowDepth, cellSize);
              break;
            case 'right':
              grad = ctx.createLinearGradient(px + cellSize, py, px + cellSize - glowDepth, py);
              grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`);
              grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
              ctx.fillStyle = grad;
              ctx.fillRect(px + cellSize - glowDepth, py, glowDepth, cellSize);
              break;
          }
        });
      });
    });

    Object.entries(territoryCells).forEach(([sid, cells]) => {
      if (!cells || cells.length === 0) return;
      const snakeColor = snakeColorMap[sid] || '#888888';
      const alpha = (selectedSnake === sid) ? 1.0 : 0.85;
      ctx.strokeStyle = hexToRgba(snakeColor, alpha);
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'square';

      ctx.beginPath();
      cells.forEach(cell => {
        const px = cell.x * cellSize;
        const py = (boardHeight - 1 - cell.y) * cellSize;

        if (shouldDrawBoundary(sid, cell.x, cell.y + 1)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px + cellSize, py);
        }
        if (shouldDrawBoundary(sid, cell.x, cell.y - 1)) {
          ctx.moveTo(px, py + cellSize);
          ctx.lineTo(px + cellSize, py + cellSize);
        }
        if (shouldDrawBoundary(sid, cell.x - 1, cell.y)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + cellSize);
        }
        if (shouldDrawBoundary(sid, cell.x + 1, cell.y)) {
          ctx.moveTo(px + cellSize, py);
          ctx.lineTo(px + cellSize, py + cellSize);
        }
      });
      ctx.stroke();
      ctx.lineCap = 'butt';
    });
  }

  function getSnakeGap(cellSize) {
    return Math.max(2, Math.floor(cellSize * 0.15));
  }

  function buildPathNeighbors(snake) {
    const pathNeighbors = {};
    for (let i = 0; i < snake.body.length; i++) {
      const key = `${snake.body[i].x},${snake.body[i].y}`;
      if (!pathNeighbors[key]) pathNeighbors[key] = new Set();
      if (i > 0) {
        pathNeighbors[key].add(`${snake.body[i - 1].x},${snake.body[i - 1].y}`);
      }
      if (i < snake.body.length - 1) {
        pathNeighbors[key].add(`${snake.body[i + 1].x},${snake.body[i + 1].y}`);
      }
    }
    return pathNeighbors;
  }

  function getCellConnections(segment, pathNeighbors) {
    const key = `${segment.x},${segment.y}`;
    const neighbors = pathNeighbors[key] || new Set();
    return {
      hasTop: neighbors.has(`${segment.x},${segment.y + 1}`),
      hasBottom: neighbors.has(`${segment.x},${segment.y - 1}`),
      hasLeft: neighbors.has(`${segment.x - 1},${segment.y}`),
      hasRight: neighbors.has(`${segment.x + 1},${segment.y}`)
    };
  }

  function renderSnakeBody(ctx, snake, boardHeight, cellSize) {
    const snakeColor = snake.customizations?.color || snake.color || '#888888';
    const gap = getSnakeGap(cellSize);

    if (snake.body.length === 0) return;

    const pathNeighbors = buildPathNeighbors(snake);

    ctx.fillStyle = snakeColor;
    const visited = new Set();
    for (let i = 0; i < snake.body.length; i++) {
      const segment = snake.body[i];
      const key = `${segment.x},${segment.y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const sx = segment.x * cellSize;
      const sy = (boardHeight - 1 - segment.y) * cellSize;

      const conn = getCellConnections(segment, pathNeighbors);

      ctx.fillRect(sx + gap, sy + gap, cellSize - 2 * gap, cellSize - 2 * gap);
      if (conn.hasRight) ctx.fillRect(sx + cellSize - gap - 1, sy + gap, gap + 1, cellSize - 2 * gap);
      if (conn.hasLeft)  ctx.fillRect(sx, sy + gap, gap + 1, cellSize - 2 * gap);
      if (conn.hasTop)   ctx.fillRect(sx + gap, sy, cellSize - 2 * gap, gap + 1);
      if (conn.hasBottom) ctx.fillRect(sx + gap, sy + cellSize - gap - 1, cellSize - 2 * gap, gap + 1);
    }
  }

  function renderInvulnerabilityOutline(ctx, snake, boardHeight, cellSize) {
    const invulnLevel = snake.invulnerabilityLevel || 0;
    if (invulnLevel === 0) return;

    const pathNeighbors = buildPathNeighbors(snake);
    const gap = getSnakeGap(cellSize);
    const glowColor = invulnLevel < 0 ? 'rgba(255, 40, 40, 1)' : 'rgba(40, 120, 255, 1)';
    const lineWidth = Math.max(2, cellSize * 0.08);
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'square';

    const visited = new Set();
    for (let i = 0; i < snake.body.length; i++) {
      const segment = snake.body[i];
      const key = `${segment.x},${segment.y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const sx = segment.x * cellSize;
      const sy = (boardHeight - 1 - segment.y) * cellSize;

      const conn = getCellConnections(segment, pathNeighbors);

      const left = conn.hasLeft ? sx : sx + gap;
      const right = conn.hasRight ? sx + cellSize : sx + cellSize - gap;
      const top = conn.hasTop ? sy : sy + gap;
      const bottom = conn.hasBottom ? sy + cellSize : sy + cellSize - gap;

      if (!conn.hasTop) {
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
        ctx.stroke();
      }
      if (!conn.hasBottom) {
        ctx.beginPath();
        ctx.moveTo(left, bottom);
        ctx.lineTo(right, bottom);
        ctx.stroke();
      }
      if (!conn.hasLeft) {
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left, bottom);
        ctx.stroke();
      }
      if (!conn.hasRight) {
        ctx.beginPath();
        ctx.moveTo(right, top);
        ctx.lineTo(right, bottom);
        ctx.stroke();
      }

      if (conn.hasRight && conn.hasBottom) {
        ctx.beginPath();
        ctx.moveTo(sx + cellSize - gap, sy + cellSize - gap);
        ctx.lineTo(sx + cellSize, sy + cellSize - gap);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx + cellSize - gap, sy + cellSize - gap);
        ctx.lineTo(sx + cellSize - gap, sy + cellSize);
        ctx.stroke();
      }
      if (conn.hasRight && conn.hasTop) {
        ctx.beginPath();
        ctx.moveTo(sx + cellSize - gap, sy + gap);
        ctx.lineTo(sx + cellSize, sy + gap);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx + cellSize - gap, sy);
        ctx.lineTo(sx + cellSize - gap, sy + gap);
        ctx.stroke();
      }
      if (conn.hasLeft && conn.hasBottom) {
        ctx.beginPath();
        ctx.moveTo(sx, sy + cellSize - gap);
        ctx.lineTo(sx + gap, sy + cellSize - gap);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx + gap, sy + cellSize - gap);
        ctx.lineTo(sx + gap, sy + cellSize);
        ctx.stroke();
      }
      if (conn.hasLeft && conn.hasTop) {
        ctx.beginPath();
        ctx.moveTo(sx, sy + gap);
        ctx.lineTo(sx + gap, sy + gap);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx + gap, sy);
        ctx.lineTo(sx + gap, sy + gap);
        ctx.stroke();
      }

    }
    ctx.lineCap = 'butt';
  }

  function processMoveEvaluations(moveEvaluations, safeMoves, head, chosenMove) {
    const moveState = {
      selectedMove: null,
      moves: {},
      safeMoves: safeMoves || [],
      territoryCells: {},
      selectedSnake: null
    };

    const directions = ['up', 'down', 'left', 'right'];
    const evaluationsMap = {};

    let evaluationsArray = [];
    if (moveEvaluations) {
      if (Array.isArray(moveEvaluations)) {
        evaluationsArray = moveEvaluations;
      } else if (moveEvaluations.evaluations) {
        evaluationsArray = moveEvaluations.evaluations;
        moveState.territoryCells = moveEvaluations.territoryCells || {};
      }
    }

    evaluationsArray.forEach(evalData => {
      evaluationsMap[evalData.move] = evalData;
    });

    directions.forEach(direction => {
      let candidatePos = null;
      switch(direction) {
        case 'up': candidatePos = {x: head.x, y: head.y + 1}; break;
        case 'down': candidatePos = {x: head.x, y: head.y - 1}; break;
        case 'left': candidatePos = {x: head.x - 1, y: head.y}; break;
        case 'right': candidatePos = {x: head.x + 1, y: head.y}; break;
      }

      const isSafe = moveState.safeMoves.includes(direction);
      const evalData = evaluationsMap[direction];

      moveState.moves[direction] = {
        direction: direction,
        position: candidatePos,
        positionKey: candidatePos ? `${candidatePos.x},${candidatePos.y}` : null,
        isSafe: isSafe,
        isChosen: direction === chosenMove,
        isEvaluated: !!evalData,
        score: evalData?.score ?? null,
        breakdown: evalData?.breakdown ?? null,
        numStates: evalData?.numStates ?? null,
        displayScore: evalData?.score ?? (isSafe ? 0 : null),
        quality: null,
        color: null
      };
    });

    const scoredMoves = Object.values(moveState.moves).filter(m => m.displayScore != null);
    const allScores = scoredMoves.map(m => m.displayScore);

    Object.values(moveState.moves).forEach(move => {
      if (move.displayScore != null && allScores.length > 0) {
        move.quality = getMoveQuality(move.displayScore, allScores);
        move.color = getScoreColor(move.displayScore, allScores);
      } else {
        move.quality = 'not-evaluated';
        move.color = 'rgba(100, 100, 100, 0.3)';
      }
    });

    return moveState;
  }

  function renderBoard(canvas, gameState, moveState, options) {
    const ctx = canvas.getContext('2d');
    const snakeId = options?.snakeId || null;
    const chosenMove = options?.chosenMove || null;
    const showChosenArrow = options?.showChosenArrow !== false;

    if (!gameState || !gameState.board) return;

    const board = gameState.board;
    const cellSize = Math.min(canvas.width / board.width, canvas.height / board.height);
    const boardW = board.width * cellSize;
    const boardH = board.height * cellSize;
    const turn = gameState.turn || 0;

    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    for (let x = 0; x <= board.width; x++) {
      const px = Math.floor(x * cellSize) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, boardH);
      ctx.stroke();
    }
    for (let y = 0; y <= board.height; y++) {
      const py = Math.floor(y * cellSize) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(boardW, py);
      ctx.stroke();
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, boardW - 2, boardH - 2);

    if (board.hazards && board.hazards.length > 0) {
      board.hazards.forEach(hazard => {
        const x = hazard.x * cellSize;
        const y = (board.height - 1 - hazard.y) * cellSize;
        ctx.save();
        ctx.fillStyle = 'rgba(220, 30, 30, 1)';
        ctx.font = `${Math.floor(cellSize * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚠', x + cellSize / 2, y + cellSize / 2);
        ctx.restore();
      });
    }

    if (board.fertileTiles && board.fertileTiles.length > 0) {
      board.fertileTiles.forEach(tile => {
        const x = tile.x * cellSize;
        const y = (board.height - 1 - tile.y) * cellSize;
        ctx.fillStyle = 'rgba(222, 198, 160, 0.4)';
        ctx.fillRect(x, y, cellSize, cellSize);
      });
    }

    if (moveState && moveState.territoryCells && Object.keys(moveState.territoryCells).length > 0) {
      const snakeColorMap = {};
      const bodyOwnerMap = {};
      board.snakes.forEach(snake => {
        snakeColorMap[snake.id] = snake.customizations?.color || snake.color || '#888888';
        snake.body.forEach(seg => {
          bodyOwnerMap[`${seg.x},${seg.y}`] = snake.id;
        });
      });
      renderTerritoryBoundaries(ctx, moveState.territoryCells, snakeColorMap, board.height, cellSize, moveState.selectedSnake, bodyOwnerMap);
    }

    if (moveState) {
      Object.values(moveState.moves).forEach(move => {
        if (move.position && (move.isSafe || move.isEvaluated)) {
          const x = move.position.x * cellSize;
          const y = (board.height - 1 - move.position.y) * cellSize;
          ctx.fillStyle = move.color;
          ctx.fillRect(x, y, cellSize, cellSize);
          if (moveState.selectedMove === move.direction) {
            ctx.strokeStyle = '#9C27B0';
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
          }
        }
      });
    }

    board.food.forEach(food => {
      const x = food.x * cellSize;
      const y = (board.height - 1 - food.y) * cellSize;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellSize, cellSize);
      ctx.clip();
      ctx.fillStyle = '#000000';
      const emojiSize = Math.max(cellSize * 0.7, 10);
      ctx.font = `${emojiSize}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u{1F383}', x + cellSize / 2, y + cellSize / 2);
      ctx.restore();
    });

    if (board.invulnerabilityPotions && board.invulnerabilityPotions.length > 0) {
      board.invulnerabilityPotions.forEach(potion => {
        const x = potion.x * cellSize;
        const y = (board.height - 1 - potion.y) * cellSize;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellSize, cellSize);
        ctx.clip();
        if (_potionImage) {
          const pad = cellSize * 0.1;
          ctx.drawImage(_potionImage, x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2);
        } else {
          const emojiSize = Math.max(cellSize * 0.7, 10);
          ctx.font = `${emojiSize}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('\u{1F9EA}', x + cellSize / 2, y + cellSize / 2);
        }
        ctx.restore();
      });
    }

    board.snakes.forEach(snake => {
      renderSnakeBody(ctx, snake, board.height, cellSize);
      renderInvulnerabilityOutline(ctx, snake, board.height, cellSize);

      const head = snake.body[0];
      if (head) {
        const hx = head.x * cellSize;
        const hy = (board.height - 1 - head.y) * cellSize;
        ctx.save();
        ctx.beginPath();
        ctx.rect(hx, hy, cellSize, cellSize);
        ctx.clip();
        const headEmojiSize = Math.max(cellSize * 0.55, 8);
        ctx.font = `${headEmojiSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(snake.emoji || '\u{1F40D}', hx + cellSize / 2, hy + cellSize / 2);
        ctx.restore();
      }

      if (turn > 0 && snake.body.length > 1) {
        const neck = snake.body[1];
        if (neck) {
          const nx = neck.x * cellSize + cellSize / 2;
          const ny = (board.height - 1 - neck.y) * cellSize + cellSize / 2;
          const labelSize = Math.max(cellSize * 0.55, 10);
          ctx.font = `${labelSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#000000';
          const lengthText = String(snake.body.length);
          ctx.fillText(lengthText, nx, ny);
        }
      }

      if (showChosenArrow && snake.id === snakeId && chosenMove) {
        const shead = snake.body[0];
        if (shead) {
          const x = shead.x * cellSize;
          const y = (board.height - 1 - shead.y) * cellSize;
          ctx.strokeStyle = '#4CAF50';
          ctx.lineWidth = 3;
          ctx.beginPath();
          const centerX = x + cellSize/2;
          const centerY = y + cellSize/2;
          let endX = centerX;
          let endY = centerY;
          switch(chosenMove) {
            case 'up': endY -= cellSize * 0.7; break;
            case 'down': endY += cellSize * 0.7; break;
            case 'left': endX -= cellSize * 0.7; break;
            case 'right': endX += cellSize * 0.7; break;
          }
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          const angle = Math.atan2(endY - centerY, endX - centerX);
          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(endX - 10 * Math.cos(angle - Math.PI/6), endY - 10 * Math.sin(angle - Math.PI/6));
          ctx.lineTo(endX - 10 * Math.cos(angle + Math.PI/6), endY - 10 * Math.sin(angle + Math.PI/6));
          ctx.closePath();
          ctx.fillStyle = '#4CAF50';
          ctx.fill();
        }
      }
    });

    return cellSize;
  }

  function createBoardOverlay(overlayEl, canvas, board, moveState, onCellClick) {
    overlayEl.innerHTML = '';
    const displayWidth = canvas.clientWidth || canvas.width;
    const displayHeight = canvas.clientHeight || canvas.height;
    overlayEl.style.width = displayWidth + 'px';
    overlayEl.style.height = displayHeight + 'px';
    const displayCellSize = Math.min(displayWidth / board.width, displayHeight / board.height);

    Object.values(moveState.moves).forEach(move => {
      if (!move.position || (!move.isSafe && !move.isEvaluated)) return;
      const button = document.createElement('button');
      button.className = 'cell-button';
      if (move.isSafe) button.className += ' candidate';
      if (moveState.selectedMove === move.direction) button.className += ' selected';

      const x = move.position.x * displayCellSize;
      const y = (board.height - 1 - move.position.y) * displayCellSize;
      button.style.left = x + 'px';
      button.style.top = y + 'px';
      button.style.width = displayCellSize + 'px';
      button.style.height = displayCellSize + 'px';
      button.style.zIndex = '10';

      if (move.isSafe || move.isEvaluated) {
        button.onclick = (e) => { e.stopPropagation(); onCellClick(move.direction); };
        const scoreText = move.score != null ? move.score.toFixed(2) : (move.isSafe ? '0.00' : 'N/A');
        button.title = `${move.direction.toUpperCase()} - Score: ${scoreText}`;
      } else {
        button.style.cursor = 'not-allowed';
        button.style.opacity = '0.3';
        button.title = `${move.direction.toUpperCase()} - UNSAFE`;
      }
      overlayEl.appendChild(button);
    });
  }

  function renderSnakeInfo(container, gameState, ourSnakeId) {
    if (!gameState || !gameState.board) {
      container.innerHTML = '';
      return;
    }
    const snakes = gameState.board.snakes;
    container.innerHTML = snakes.map(snake => {
      const isOurSnake = snake.id === ourSnakeId;
      const snakeColor = snake.customizations?.color || snake.color || '#888888';
      const invulnLevel = snake.invulnerabilityLevel || 0;
      const invulnDisplay = invulnLevel !== 0
        ? `<span>${invulnLevel > 0 ? '\u{1F6E1}\uFE0F' : '\u26A0\uFE0F'} ${invulnLevel}</span>`
        : '';
      const emojiDisplay = snake.emoji || '\u{1F40D}';
      return `
        <div class="snake-info-item">
          <div class="snake-color-box" style="background-color: ${snakeColor};"></div>
          <div class="snake-details">
            <div class="snake-name">${emojiDisplay} ${snake.name}${isOurSnake ? ' (You)' : ''}</div>
            <div class="snake-id" style="font-size: 0.75em; color: #888; margin-top: 1px;">${snake.id}</div>
            <div class="snake-stats">
              <span>\u2764\uFE0F ${snake.health}</span>
              <span>\u{1F4CF} ${snake.body.length}</span>
              ${invulnDisplay}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderMoveButtons(container, moveState, onMoveClick) {
    const buttonLayout = [
      null, 'up', null,
      'left', 'down', 'right'
    ];

    container.innerHTML = buttonLayout.map(direction => {
      if (!direction) {
        return '<div style="grid-column: span 1;"></div>';
      }
      const move = moveState.moves[direction];
      if (!move) return '';

      let classes = ['move-button'];
      if (move.isChosen) classes.push('chosen');
      if (moveState.selectedMove === direction) classes.push('selected');

      const canInteract = move.isSafe || move.isEvaluated;
      const scoreText = move.score != null ?
        `Score: ${move.score.toFixed(2)}` :
        (move.isSafe ? 'Score: 0.00' : 'Not evaluated');

      const bgColor = move.color || 'rgba(100, 100, 100, 0.3)';
      const solidColor = bgColor.replace('0.3)', '0.8)');

      return `
        <button class="${classes.join(' ')}"
                ${canInteract ? `onclick="BoardRenderer._moveClickHandler('${direction}')"` : 'disabled'}
                style="background: ${solidColor}; ${!canInteract ? 'cursor: not-allowed;' : ''}">
          ${direction.toUpperCase()} ${move.isChosen ? '\u2713' : ''}
          <span class="score">${scoreText}</span>
        </button>
      `;
    }).join('');

    BoardRenderer._moveClickHandler = onMoveClick;
  }

  function updateStatsTable(tbody, move, moveState) {
    if (!move || !move.breakdown) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: #888;">Select a move to see breakdown</td>
        </tr>
      `;
      return;
    }

    const breakdown = move.breakdown;
    const candidateMoves = Object.values(moveState.moves).filter(m => m.isEvaluated || m.isSafe);
    const averageWeighted = {};

    if (candidateMoves.length > 0) {
      const weightedSums = {
        myLengthScore: 0, myTerritoryScore: 0, myControlledFoodScore: 0,
        myControlledFertileScore: 0, teamLengthScore: 0, teamTerritoryScore: 0,
        teamControlledFoodScore: 0, foodProximityScore: 0, foodEatenScore: 0,
        enemyTerritoryScore: 0, enemyLengthScore: 0, edgePenaltyScore: 0,
        selfEnoughSpaceScore: 0, selfSpaceOptimisticScore: 0,
        alliesEnoughSpaceScore: 0, opponentsEnoughSpaceScore: 0,
        killsScore: 0, deathsScore: 0, enemyH2HRiskScore: 0,
        allyH2HRiskScore: 0, fertileScore: 0
      };

      candidateMoves.forEach(candidateMove => {
        if (candidateMove.breakdown?.weighted) {
          const weighted = candidateMove.breakdown.weighted;
          for (const key in weightedSums) {
            weightedSums[key] += weighted[key] ?? 0;
          }
        }
      });

      const count = candidateMoves.length;
      for (const key in weightedSums) {
        averageWeighted[key] = weightedSums[key] / count;
      }
    }

    function formatValue(value) {
      if (typeof value === 'number') {
        if (Number.isInteger(value)) return value.toString();
        return value.toFixed(2);
      }
      return value;
    }

    const metricsConfig = [
      { name: 'My Length', value: breakdown.myLength ?? 0, weight: breakdown.weights?.myLength ?? 10, weightedScore: breakdown.weighted?.myLengthScore ?? 0, averageWeighted: averageWeighted.myLengthScore ?? 0 },
      { name: 'My Territory', value: breakdown.myTerritory ?? 0, weight: breakdown.weights?.myTerritory ?? 1, weightedScore: breakdown.weighted?.myTerritoryScore ?? 0, averageWeighted: averageWeighted.myTerritoryScore ?? 0 },
      { name: 'My Controlled Food', value: breakdown.myControlledFood ?? breakdown.myFoodCount ?? 0, weight: breakdown.weights?.myControlledFood ?? 10, weightedScore: breakdown.weighted?.myControlledFoodScore ?? 0, averageWeighted: averageWeighted.myControlledFoodScore ?? 0 },
      { name: 'My Fertile Ground', value: breakdown.myControlledFertile ?? 0, weight: breakdown.weights?.myControlledFertile ?? 2, weightedScore: breakdown.weighted?.myControlledFertileScore ?? 0, averageWeighted: averageWeighted.myControlledFertileScore ?? 0 },
      { name: 'Team Length', value: breakdown.teamLength ?? 0, weight: breakdown.weights?.teamLength ?? 10, weightedScore: breakdown.weighted?.teamLengthScore ?? 0, averageWeighted: averageWeighted.teamLengthScore ?? 0 },
      { name: 'Team Territory', value: breakdown.teamTerritory ?? 0, weight: breakdown.weights?.teamTerritory ?? 1, weightedScore: breakdown.weighted?.teamTerritoryScore ?? 0, averageWeighted: averageWeighted.teamTerritoryScore ?? 0 },
      { name: 'Team Controlled Food', value: breakdown.teamControlledFood ?? breakdown.teamFoodCount ?? 0, weight: breakdown.weights?.teamControlledFood ?? 10, weightedScore: breakdown.weighted?.teamControlledFoodScore ?? 0, averageWeighted: averageWeighted.teamControlledFoodScore ?? 0 },
      { name: 'Food Distance', value: breakdown.foodDistance ?? 'N/A', weight: 0, weightedScore: 0, averageWeighted: 0 },
      { name: 'Food Proximity', value: breakdown.foodProximity ?? breakdown.foodDistanceInverse ?? 0, weight: breakdown.weights?.foodProximity ?? 50, weightedScore: breakdown.weighted?.foodProximityScore ?? 0, averageWeighted: averageWeighted.foodProximityScore ?? 0 },
      { name: 'Food Eaten', value: breakdown.foodEaten ?? 0, weight: breakdown.weights?.foodEaten ?? 200, weightedScore: breakdown.weighted?.foodEatenScore ?? 0, averageWeighted: averageWeighted.foodEatenScore ?? 0 },
      { name: 'Enemy Territory', value: breakdown.enemyTerritory ?? 0, weight: breakdown.weights?.enemyTerritory ?? 0, weightedScore: breakdown.weighted?.enemyTerritoryScore ?? 0, averageWeighted: averageWeighted.enemyTerritoryScore ?? 0 },
      { name: 'Enemy Length', value: breakdown.enemyLength ?? 0, weight: breakdown.weights?.enemyLength ?? 0, weightedScore: breakdown.weighted?.enemyLengthScore ?? 0, averageWeighted: averageWeighted.enemyLengthScore ?? 0 },
      { name: 'Edge Penalty', value: breakdown.edgePenalty ?? (breakdown.stats?.edgePenalty ?? 0), weight: breakdown.weights?.edgePenalty ?? 50, weightedScore: breakdown.weighted?.edgePenaltyScore ?? 0, averageWeighted: averageWeighted.edgePenaltyScore ?? 0 },
      { name: 'Self Space', value: breakdown.selfEnoughSpace ?? (breakdown.stats?.selfEnoughSpace ?? 0), weight: breakdown.weights?.selfEnoughSpace ?? 10, weightedScore: breakdown.weighted?.selfEnoughSpaceScore ?? 0, averageWeighted: averageWeighted.selfEnoughSpaceScore ?? 0 },
      { name: 'Self Space (Optimistic)', value: breakdown.selfSpaceOptimistic ?? (breakdown.stats?.selfSpaceOptimistic ?? 0), weight: breakdown.weights?.selfSpaceOptimistic ?? 5, weightedScore: breakdown.weighted?.selfSpaceOptimisticScore ?? 0, averageWeighted: averageWeighted.selfSpaceOptimisticScore ?? 0 },
      { name: 'Allies Space', value: breakdown.alliesEnoughSpace ?? (breakdown.stats?.alliesEnoughSpace ?? 0), weight: breakdown.weights?.alliesEnoughSpace ?? 5, weightedScore: breakdown.weighted?.alliesEnoughSpaceScore ?? 0, averageWeighted: averageWeighted.alliesEnoughSpaceScore ?? 0 },
      { name: 'Opponents Space', value: breakdown.opponentsEnoughSpace ?? (breakdown.stats?.opponentsEnoughSpace ?? 0), weight: breakdown.weights?.opponentsEnoughSpace ?? -5, weightedScore: breakdown.weighted?.opponentsEnoughSpaceScore ?? 0, averageWeighted: averageWeighted.opponentsEnoughSpaceScore ?? 0 },
      { name: 'Kills', value: breakdown.kills ?? 0, weight: breakdown.weights?.kills ?? 0, weightedScore: breakdown.weighted?.killsScore ?? 0, averageWeighted: averageWeighted.killsScore ?? 0 },
      { name: 'Deaths', value: breakdown.deaths ?? 0, weight: breakdown.weights?.deaths ?? 0, weightedScore: breakdown.weighted?.deathsScore ?? 0, averageWeighted: averageWeighted.deathsScore ?? 0 },
      { name: 'Enemy H2H Risk', value: breakdown.enemyH2HRisk ?? 0, weight: breakdown.weights?.enemyH2HRisk ?? 0, weightedScore: breakdown.weighted?.enemyH2HRiskScore ?? 0, averageWeighted: averageWeighted.enemyH2HRiskScore ?? 0 },
      { name: 'Ally H2H Risk', value: breakdown.allyH2HRisk ?? 0, weight: breakdown.weights?.allyH2HRisk ?? 0, weightedScore: breakdown.weighted?.allyH2HRiskScore ?? 0, averageWeighted: averageWeighted.allyH2HRiskScore ?? 0 },
      ...(breakdown.fertileTerritory !== undefined && !breakdown.myTerritory ? [{
        name: 'Fertile Territory', value: breakdown.fertileTerritory ?? 0, weight: breakdown.weights?.fertileTerritory ?? 1, weightedScore: breakdown.weighted?.fertileScore ?? 0, averageWeighted: averageWeighted.fertileScore ?? 0
      }] : [])
    ];

    metricsConfig.forEach(metric => {
      metric.marginalImpact = metric.weightedScore - metric.averageWeighted;
    });

    metricsConfig.sort((a, b) => Math.abs(b.marginalImpact) - Math.abs(a.marginalImpact));

    let rows = metricsConfig.map(metric => {
      const weightDisplay = metric.weight !== 0 ? metric.weight : '';
      const scoreDisplay = metric.weight !== 0 ? metric.weightedScore.toFixed(2) : '';
      const impactDisplay = metric.weight !== 0 ?
        (metric.marginalImpact >= 0 ? '+' : '') + metric.marginalImpact.toFixed(2) : '';
      let impactColor = '#888';
      if (metric.marginalImpact > 0) impactColor = '#4CAF50';
      else if (metric.marginalImpact < 0) impactColor = '#f44336';
      return `
        <tr>
          <td>${metric.name}</td>
          <td>${formatValue(metric.value)}</td>
          <td>${weightDisplay}</td>
          <td>${scoreDisplay}</td>
          <td style="color: ${impactColor}; font-weight: 600;">${impactDisplay}</td>
        </tr>
      `;
    });

    const totalMarginalImpact = move.score - (candidateMoves.reduce((sum, m) => sum + (m.score ?? 0), 0) / candidateMoves.length);
    rows.push(`
      <tr class="total-row">
        <td>Total Score</td>
        <td colspan="2">States: ${move.numStates || 1}</td>
        <td>${(move.score ?? 0).toFixed(2)}</td>
        <td style="color: ${totalMarginalImpact >= 0 ? '#4CAF50' : '#f44336'}; font-weight: 600;">
          ${totalMarginalImpact >= 0 ? '+' : ''}${totalMarginalImpact.toFixed(2)}
        </td>
      </tr>
    `);

    tbody.innerHTML = rows.join('');
  }

  function renderMinimap(canvas, gameState, ourSnakeId) {
    const ctx = canvas.getContext('2d');
    if (!gameState || !gameState.board) return;
    const board = gameState.board;
    const cellSize = Math.min(canvas.width / board.width, canvas.height / board.height);
    const boardW = board.width * cellSize;
    const boardH = board.height * cellSize;

    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    for (let x = 0; x <= board.width; x++) {
      const px = Math.floor(x * cellSize) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, boardH);
      ctx.stroke();
    }
    for (let y = 0; y <= board.height; y++) {
      const py = Math.floor(y * cellSize) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(boardW, py);
      ctx.stroke();
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, boardW - 2, boardH - 2);

    if (board.hazards && board.hazards.length > 0) {
      board.hazards.forEach(hazard => {
        const x = hazard.x * cellSize;
        const y = (board.height - 1 - hazard.y) * cellSize;
        ctx.save();
        ctx.fillStyle = 'rgba(220, 30, 30, 1)';
        ctx.font = `${Math.floor(cellSize * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚠', x + cellSize / 2, y + cellSize / 2);
        ctx.restore();
      });
    }

    if (board.fertileTiles && board.fertileTiles.length > 0) {
      board.fertileTiles.forEach(tile => {
        const x = tile.x * cellSize;
        const y = (board.height - 1 - tile.y) * cellSize;
        ctx.fillStyle = 'rgba(222, 198, 160, 0.4)';
        ctx.fillRect(x, y, cellSize, cellSize);
      });
    }

    board.food.forEach(food => {
      const x = food.x * cellSize;
      const y = (board.height - 1 - food.y) * cellSize;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellSize, cellSize);
      ctx.clip();
      const emojiSize = Math.max(cellSize * 0.7, 6);
      ctx.font = `${emojiSize}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u{1F383}', x + cellSize / 2, y + cellSize / 2);
      ctx.restore();
    });

    if (board.invulnerabilityPotions && board.invulnerabilityPotions.length > 0) {
      board.invulnerabilityPotions.forEach(potion => {
        const x = potion.x * cellSize;
        const y = (board.height - 1 - potion.y) * cellSize;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellSize, cellSize);
        ctx.clip();
        if (_potionImage) {
          ctx.drawImage(_potionImage, x, y, cellSize, cellSize);
        } else {
          const emojiSize = Math.max(cellSize * 0.7, 6);
          ctx.font = `${emojiSize}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('\u{1F9EA}', x + cellSize / 2, y + cellSize / 2);
        }
        ctx.restore();
      });
    }

    board.snakes.forEach(snake => {
      const isOurs = snake.id === ourSnakeId;

      renderSnakeBody(ctx, snake, board.height, cellSize);
      renderInvulnerabilityOutline(ctx, snake, board.height, cellSize);

      const head = snake.body[0];
      if (head) {
        const x = head.x * cellSize;
        const y = (board.height - 1 - head.y) * cellSize;
        if (isOurs) {
          ctx.strokeStyle = '#FFD700';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, cellSize, cellSize);
        }
      }
    });
  }

  return {
    hexToRgba,
    getMoveQuality,
    getScoreColor,
    processMoveEvaluations,
    renderBoard,
    createBoardOverlay,
    renderSnakeInfo,
    renderMoveButtons,
    updateStatsTable,
    renderMinimap,
    renderTerritoryBoundaries,
    _moveClickHandler: null
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BoardRenderer;
}
