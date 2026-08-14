const BoardRenderer = (function () {
  let _potionImage = null;
  let _potionImageLoading = false;

  function loadPotionImage() {
    if (_potionImage || _potionImageLoading) return;
    _potionImageLoading = true;
    const img = new Image();
    img.onload = () => {
      _potionImage = img;
    };
    img.onerror = () => {
      _potionImageLoading = false;
    };
    img.src = "/invulnerability-potion.png";
  }

  if (typeof window !== "undefined") {
    loadPotionImage();
  }

  function hexToRgba(hex, alpha) {
    let color = hex;
    if (!color || typeof color !== "string") {
      return `rgba(136, 136, 136, ${alpha})`;
    }
    color = color.replace("#", "");
    if (color.length === 3) {
      color = color
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const r = parseInt(color.substring(0, 2), 16) || 136;
    const g = parseInt(color.substring(2, 4), 16) || 136;
    const b = parseInt(color.substring(4, 6), 16) || 136;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Given the previous turn's snakes and the current turn's snakes, return the
  // snakes that vanished (present last turn, gone this turn) along with their
  // LAST-KNOWN head position and body. We deliberately do NOT infer or advance
  // the death cell: the game server currently removes a snake from board.snakes
  // the moment it dies, so its true final resting place is not available here.
  // Reporting the last-known position is honest (that is genuinely where the
  // snake was); a real final-resting-place marker requires the server to keep
  // dead snakes in the state for one turn. `excludeIds` skips snakes whose
  // markers are drawn explicitly elsewhere (e.g. our own snake).
  function getDisappearedSnakes(prevSnakes, currentSnakes, excludeIds) {
    if (!prevSnakes || prevSnakes.length === 0) return [];
    const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
    const currentIds = new Set((currentSnakes || []).map((s) => s.id));
    const dead = [];
    prevSnakes.forEach((s) => {
      if (currentIds.has(s.id) || exclude.has(s.id)) return;
      const prevBody =
        s.body && s.body.length ? s.body : s.head ? [s.head] : [];
      if (!prevBody.length) return;
      dead.push({
        id: s.id,
        head: prevBody[0],
        body: prevBody.slice(),
        color: s.customizations?.color || s.color || "#888888",
      });
    });
    return dead;
  }

  // ── Unit facing ──────────────────────────────────────────────────────────
  // Every unit carries its WIRE orientation on Snake.facing (Turn.unitFacing,
  // verbatim: full-board convention, dy grows DOWNWARD), and icons render
  // rotated to it, live and replay.
  // Screen rotation for a wire facing vector: clockwise radians from
  // straight up. Both canvas rotate() (y down) and SVG rotate() treat
  // positive as clockwise on screen, so one formula serves both.
  function facingRotationRad(facing) {
    return Math.atan2(facing.dx, -facing.dy);
  }

  // Unit icons: custom-drawn marks (SVG path data in a 24×24 box) that stay
  // distinctive at ~20px, where the old Unicode chess glyphs blurred together.
  // Each icon is an ordered list of layers; a layer is either a filled shape
  // (white with a dark outline so it reads on any team colour) or a stroked
  // detail. The SAME definitions drive the canvas head glyphs on the board
  // (via Path2D in drawUnitIcon) and the inline-SVG icons in the per-team
  // units table (via unitIconSVG), so the two can never drift apart.
  // Design notes for small-size separability: pawn = round head on a squat
  // base; bishop = tall pointed mitre with a dark slash; rook = square
  // crenellations; king = big cross over a plain body; queen = spiky crown
  // with dots; knight = horse silhouette; snake = S-curve serpent.
  // ORIENTATION: icons render ROTATED to the unit's facing, so every drawing
  // carries a discernible "nose" at its TOP — pawn: spiked helmet tip;
  // bishop: pointed mitre + ball; rook: crenellations; knight: upright ears;
  // queen: crown spikes; king: cross; snake: head with an upward forked
  // tongue.
  const ICON_COLORS = {
    base: "#ffffff",
    line: "rgba(0, 0, 0, 0.8)",
    accent: "#e53935",
  };
  const UNIT_ICONS = {
    pawn: [
      {
        // Spiked helmet tip (the "nose") over the round head: an upward
        // point that makes the pawn's facing readable under rotation.
        d:
          "M12 0.9 L14.1 4.9 L9.9 4.9 Z " +
          "M12 3.4 a3.2 3.2 0 1 0 0.001 0 Z " +
          "M10.6 10.4 L9.4 16.2 L5.8 18.3 L5.8 20.8 L18.2 20.8 L18.2 18.3 L14.6 16.2 L13.4 10.4 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
    ],
    bishop: [
      {
        d:
          "M12 1.6 a1.7 1.7 0 1 0 0.001 0 Z " +
          "M12 5.6 C9 8.2 7.5 10.7 7.5 12.9 C7.5 15.3 9.4 16.9 12 16.9 C14.6 16.9 16.5 15.3 16.5 12.9 C16.5 10.7 15 8.2 12 5.6 Z " +
          "M7.2 18.4 L16.8 18.4 L17.8 20.8 L6.2 20.8 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
      { d: "M12.2 7.6 L15.2 11.2", op: "stroke", color: "line", w: 1.6 },
    ],
    rook: [
      {
        d:
          "M5.5 3.2 L8.3 3.2 L8.3 5.8 L10.6 5.8 L10.6 3.2 L13.4 3.2 L13.4 5.8 L15.7 5.8 L15.7 3.2 L18.5 3.2 " +
          "L18.5 8.2 L16.8 9.8 L16.8 16.6 L18.5 18.2 L18.5 20.8 L5.5 20.8 L5.5 18.2 L7.2 16.6 L7.2 9.8 L5.5 8.2 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
    ],
    knight: [
      {
        d:
          "M7 20.8 C7 15.6 8.9 13.7 11.3 12.4 C9.8 13 7.9 13.2 7.1 12.3 C6.5 11.6 6.9 10.6 7.6 9.9 " +
          "C9.1 8.5 10.5 7.1 11 5.3 L11.8 3 L13 5.1 C16.8 6.7 18.8 9.9 18.8 14.1 L18.8 20.8 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
      { d: "M12.9 6.6 a1 1 0 1 0 0.001 0 Z", op: "fill", color: "line" },
    ],
    queen: [
      {
        d:
          "M4.3 4.4 a1.4 1.4 0 1 0 0.001 0 Z " +
          "M12 1.9 a1.5 1.5 0 1 0 0.001 0 Z " +
          "M19.7 4.4 a1.4 1.4 0 1 0 0.001 0 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
      {
        d: "M4.3 8.6 L8.2 12.6 L12 7 L15.8 12.6 L19.7 8.6 L18.1 17 L5.9 17 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
      {
        d: "M6.3 18.5 L17.7 18.5 L18.4 20.8 L5.6 20.8 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
    ],
    king: [
      {
        d: "M10.8 1.6 L13.2 1.6 L13.2 3.8 L15.4 3.8 L15.4 6.2 L13.2 6.2 L13.2 8.4 L10.8 8.4 L10.8 6.2 L8.6 6.2 L8.6 3.8 L10.8 3.8 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
      {
        d:
          "M7.6 9.6 L16.4 9.6 L17.4 17.2 L6.6 17.2 Z " +
          "M6.2 18.5 L17.8 18.5 L18.5 20.8 L5.5 20.8 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
    ],
    snake: [
      // Head at top CENTER with an upward forked tongue (the "nose"), so the
      // rotated icon points cleanly along the snake's facing; the S-body
      // trails down to the tail at bottom-left.
      {
        d: "M6.4 20.6 C14 20.6 15.3 17.7 10.3 16.1 C5.9 14.7 6 10.9 10.4 9.8 C12.5 9.3 13.3 8.6 12.7 7.4",
        op: "stroke",
        color: "line",
        w: 5.4,
      },
      {
        d: "M6.4 20.6 C14 20.6 15.3 17.7 10.3 16.1 C5.9 14.7 6 10.9 10.4 9.8 C12.5 9.3 13.3 8.6 12.7 7.4",
        op: "stroke",
        color: "base",
        w: 3.2,
      },
      {
        d: "M12 2.5 a2.6 2.6 0 1 0 0.001 0 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
      { d: "M12.9 4.1 a0.8 0.8 0 1 0 0.001 0 Z", op: "fill", color: "line" },
      {
        d: "M12 2.5 L12 1 M12 1 L11.1 0.3 M12 1 L12.9 0.3",
        op: "stroke",
        color: "accent",
        w: 1.3,
      },
    ],
  };

  // Draw a unit icon centred at (cx, cy) with the given pixel size on a canvas.
  // Filled layers stroke their dark outline FIRST so the outline sits behind
  // the fill (bold mark, thin dark rim). `rotation` (clockwise screen
  // radians, optional) spins the icon about its centre — the unit's facing.
  function drawUnitIcon(ctx, unitKey, cx, cy, size, rotation) {
    const icon = UNIT_ICONS[unitKey] || UNIT_ICONS.snake;
    ctx.save();
    ctx.translate(cx, cy);
    if (rotation) ctx.rotate(rotation);
    ctx.translate(-size / 2, -size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const layer of icon) {
      const p = new Path2D(layer.d);
      const color = ICON_COLORS[layer.color] || ICON_COLORS.base;
      if (layer.op === "stroke") {
        ctx.strokeStyle = color;
        ctx.lineWidth = layer.w || 2;
        ctx.stroke(p);
      } else {
        if (layer.outline) {
          ctx.strokeStyle = ICON_COLORS.line;
          ctx.lineWidth = 2.4;
          ctx.stroke(p);
        }
        ctx.fillStyle = color;
        ctx.fill(p);
      }
    }
    ctx.restore();
  }

  // Same icon as inline SVG markup (for the per-team units table rows). Layer
  // order matches drawUnitIcon exactly: the outline is emitted as a separate
  // stroke-only path BEFORE the fill path so it renders behind the fill.
  // `rotationDeg` (clockwise, optional) spins the icon about the viewBox
  // centre — the same facing rotation the board head glyph gets.
  function unitIconSVG(unitKey, sizePx, rotationDeg) {
    const icon = UNIT_ICONS[unitKey] || UNIT_ICONS.snake;
    const parts = [];
    for (const layer of icon) {
      const color = ICON_COLORS[layer.color] || ICON_COLORS.base;
      if (layer.op === "stroke") {
        parts.push(
          `<path d="${layer.d}" fill="none" stroke="${color}" stroke-width="${layer.w || 2}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
      } else {
        if (layer.outline) {
          parts.push(
            `<path d="${layer.d}" fill="none" stroke="${ICON_COLORS.line}" stroke-width="2.4" stroke-linejoin="round"/>`,
          );
        }
        parts.push(`<path d="${layer.d}" fill="${color}"/>`);
      }
    }
    const body = rotationDeg
      ? `<g transform="rotate(${rotationDeg.toFixed(1)} 12 12)">${parts.join("")}</g>`
      : parts.join("");
    return `<svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true" style="display:block;">${body}</svg>`;
  }

  // The four staged-move direction strings. Chess pieces stage NUMERIC moves
  // (full-board destination index); anything not in this set must never be fed
  // to the direction-arrow paths — the piece's destination is already
  // visualized by the goto waypoint overlay (green cell).
  function isDirectionMove(move) {
    return move === "up" || move === "down" || move === "left" || move === "right";
  }

  // A numeric staged move is a chess piece's FULL-BOARD destination index
  // (perimeter included, y grows downward). Resolve it to the api-coord board
  // cell, or null when it isn't a numeric move / lands outside the playable
  // interior. This is what lets the one arrow path draw slider/knight staged
  // moves as a single straight arrow to the destination.
  function moveDestinationCell(move, board) {
    if (typeof move !== "number" || !board) return null;
    const fullW = board.width + 2;
    const fullH = board.height + 2;
    const x = (move % fullW) - 1;
    const y = fullH - Math.floor(move / fullW) - 2;
    if (x < 0 || x >= board.width || y < 0 || y >= board.height) return null;
    return { x, y };
  }

  // Head glyph: every unit's head cell draws its unit ICON — the shared
  // drawn snake icon for snakes, the custom-drawn piece marks for chess
  // pieces (see UNIT_ICONS) — ROTATED to the unit's wire facing
  // (snake.facing). The unit's LETTER lives in its unit tag
  // (renderUnitTags), not on the head. Pawns additionally carry their
  // facing triangle (the one facing that gates move legality) and
  // staged-rotation badge; their weight shows in the unit tag. Only the
  // icon rotates: triangle, badge, tags and health bars stay
  // screen-aligned.
  function drawHeadGlyph(ctx, snake, hx, hy, cellSize, glyphOpts) {
    const iconRotation = facingRotationRad(snake.facing);
    const cx = hx + cellSize / 2;
    // Nudged slightly above center so the glyph clears the health bar
    // anchored to the cell's bottom edge (drawHealthBar).
    const cy = hy + cellSize / 2 - cellSize * 0.06;
    ctx.save();
    ctx.beginPath();
    ctx.rect(hx, hy, cellSize, cellSize);
    ctx.clip();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (snake.unitType) {
      // Pawn facing: a small triangle hugging the faced cell edge. The wire
      // facing has y growing DOWNWARD (full-board convention), which matches
      // canvas rows exactly, so dx/dy apply to canvas offsets with no flip.
      // PAWN-ONLY: every unit carries a wire facing, but only the pawn's
      // gates move legality, so only pawns get the explicit edge marker —
      // other pieces show orientation through icon rotation alone.
      if (snake.unitType === "pawn") {
        const fdx = snake.facing.dx;
        const fdy = snake.facing.dy;
        const edgeX = cx + fdx * (cellSize / 2);
        const edgeY = cy + fdy * (cellSize / 2);
        const half = cellSize * 0.14; // triangle half-width along the edge
        const depth = cellSize * 0.16; // how far the base sits inside the cell
        // Perpendicular of the facing vector spans the triangle's base.
        const px = -fdy;
        const py = fdx;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
        ctx.lineWidth = Math.max(1, cellSize * 0.04);
        ctx.beginPath();
        ctx.moveTo(edgeX, edgeY); // tip on the faced edge
        ctx.lineTo(edgeX - fdx * depth + px * half, edgeY - fdy * depth + py * half);
        ctx.lineTo(edgeX - fdx * depth - px * half, edgeY - fdy * depth - py * half);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      drawUnitIcon(ctx, snake.unitType, cx, cy, Math.max(cellSize * 0.78, 12), iconRotation);
      // Staged-rotation badge (pawns): a ↻/↺ in the top-left corner (the
      // mirror of the bottom-right weight badge) while a side-square rotation
      // is staged — the piece spends the turn turning, so no destination
      // arrow is drawn. Both facing and the staged rotation use the wire
      // convention (y grows downward), which matches canvas rows: a positive
      // cross product is a clockwise (screen) quarter turn.
      const stagedRotation = glyphOpts && glyphOpts.stagedRotation;
      if (stagedRotation) {
        const f = snake.facing;
        let rotGlyph = "↻"; // ↻ clockwise
        if (f && (f.dx || f.dy)) {
          const cross = f.dx * stagedRotation.dy - f.dy * stagedRotation.dx;
          if (cross < 0) rotGlyph = "↺"; // ↺ counter-clockwise
        }
        const rotSize = Math.max(cellSize * 0.34, 8);
        ctx.font = `bold ${rotSize}px sans-serif`;
        const rx = hx + cellSize * 0.2;
        const ry = hy + cellSize * 0.3;
        ctx.lineWidth = Math.max(cellSize * 0.06, 1.5);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
        ctx.strokeText(rotGlyph, rx, ry);
        ctx.fillStyle = "#80d8ff";
        ctx.fillText(rotGlyph, rx, ry);
      }
    } else {
      // Snakes (and any letter/emoji-era historical unit): the uniform drawn
      // snake icon. The identifying letter (or historic emoji) shows in the
      // unit tag instead.
      drawUnitIcon(ctx, "snake", cx, cy, Math.max(cellSize * 0.8, 12), iconRotation);
    }
    ctx.restore();
  }

  // Health-bar fill colour by remaining fraction: red when nearly starved,
  // orange when low, green otherwise. Shared by the board bar and the unit
  // info panel so the two readouts always agree.
  function healthBarColor(frac) {
    if (frac < 0.1) return "#e53935";
    if (frac < 0.25) return "#fb8c00";
    return "#43a047";
  }

  // Health fraction for a snake: health over its configured per-type max
  // (snake.maxHealth, engine default 100), clamped to [0, 1].
  function healthFraction(snake) {
    const max = snake.maxHealth ?? 100;
    if (!(max > 0)) return 0;
    return Math.max(0, Math.min(1, (snake.health ?? 0) / max));
  }

  // Prominent per-unit health bar on the unit's key cell (snake head cell /
  // piece cell): bottom-anchored, ~90% of the cell wide, ~15% tall, a dark
  // translucent track under a red/orange/green fill. Callers skip ghost/dead
  // snakes — a corpse has no health to read.
  function drawHealthBar(ctx, snake, hx, hy, cellSize) {
    if (typeof snake.health !== "number") return; // pre-health historical rows
    const frac = healthFraction(snake);
    const barW = cellSize * 0.9;
    const barH = Math.max(2, cellSize * 0.15);
    const inset = Math.max(1, cellSize * 0.03);
    const bx = hx + (cellSize - barW) / 2;
    const by = hy + cellSize - barH - inset;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(bx, by, barW, barH);
    if (frac > 0) {
      ctx.fillStyle = healthBarColor(frac);
      ctx.fillRect(bx, by, barW * frac, barH);
    }
    ctx.restore();
  }

  // Move a board cell one step in a Battlesnake direction. Returns null for
  // missing inputs so callers can fall back gracefully. y grows upward in board
  // coordinates (the renderer flips it for canvas y).
  function applyDirection(cell, move) {
    if (!cell || !move) return null;
    switch (move) {
      case "up":
        return { x: cell.x, y: cell.y + 1 };
      case "down":
        return { x: cell.x, y: cell.y - 1 };
      case "left":
        return { x: cell.x - 1, y: cell.y };
      case "right":
        return { x: cell.x + 1, y: cell.y };
    }
    return null;
  }

  // Single source of truth for on-board click hit-testing. Maps a click event
  // to a board cell using the CSS-displayed size (`getBoundingClientRect`) for
  // BOTH the cell size and the click offset, so it stays correct when the canvas
  // is scaled by CSS (its internal pixel buffer can differ from its rendered
  // size). Returns the board cell `{x, y}` (origin bottom-left, matching the
  // renderer's coordinate system). Callers should range-check against the board.
  function getClickedCell(canvas, board, event) {
    if (!canvas || !board) return null;
    const rect = canvas.getBoundingClientRect();
    const cellSize = Math.min(rect.width / board.width, rect.height / board.height);
    if (!cellSize) return null;
    const x = Math.floor((event.clientX - rect.left) / cellSize);
    const y = board.height - 1 - Math.floor((event.clientY - rect.top) / cellSize);
    return { x, y };
  }

  // Find the first snake whose body occupies `cell`. An optional `filter(snake)`
  // predicate lets each surface keep its own clickability gating rule.
  function findSnakeAtCell(board, cell, filter) {
    if (!board || !cell) return null;
    for (const snake of board.snakes) {
      if (filter && !filter(snake)) continue;
      if (snake.body.some((seg) => seg.x === cell.x && seg.y === cell.y)) {
        return snake;
      }
    }
    return null;
  }

  // Find the id of the snake whose Voronoi territory owns `cell`, or null.
  function findTerritoryOwnerAtCell(territoryCells, cell) {
    if (!territoryCells || !cell) return null;
    for (const [sid, cells] of Object.entries(territoryCells)) {
      if (cells && cells.some((c) => c.x === cell.x && c.y === cell.y)) {
        return sid;
      }
    }
    return null;
  }

  // Draw a dead-head marker at a board cell. A solid marker (shadow=false) is a
  // filled disc in the snake's color with a white ✗; a shadow marker
  // (shadow=true) is a ghosted/translucent disc with a dashed outline and a
  // colored ✗, used for our snake's INTENDED (attempted) move when it differs
  // from where the server actually placed us.
  function drawDeathMarker(ctx, head, boardHeight, cellSize, color, shadow) {
    if (!head) return;
    const cx = head.x * cellSize + cellSize / 2;
    const cy = (boardHeight - 1 - head.y) * cellSize + cellSize / 2;
    const r = cellSize * 0.34;
    const markColor = color || "#888888";
    ctx.save();
    if (shadow) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = markColor;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash([
        Math.max(2, cellSize * 0.1),
        Math.max(2, cellSize * 0.08),
      ]);
      ctx.lineWidth = Math.max(1.5, cellSize * 0.06);
      ctx.strokeStyle = markColor;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = markColor;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, cellSize * 0.07);
      ctx.strokeStyle = "#000000";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const d = r * 0.55;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5, cellSize * 0.1);
    ctx.strokeStyle = shadow ? markColor : "#ffffff";
    ctx.globalAlpha = shadow ? 0.85 : 1;
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - d);
    ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d);
    ctx.lineTo(cx - d, cy + d);
    ctx.stroke();
    ctx.restore();
  }

  // Drawn at a snake's LAST-KNOWN head when we have no authoritative final
  // resting position from the server. A "?" inside a disc with arrows pointing
  // outward in all four directions: it could have ended up anywhere from here.
  function drawUnknownDeathMarker(ctx, head, boardHeight, cellSize, color) {
    if (!head) return;
    const cx = head.x * cellSize + cellSize / 2;
    const cy = (boardHeight - 1 - head.y) * cellSize + cellSize / 2;
    const r = cellSize * 0.34;
    const markColor = color || "#888888";
    ctx.save();
    // Disc background so the glyph reads on any board cell.
    ctx.fillStyle = markColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, cellSize * 0.07);
    ctx.strokeStyle = "#000000";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Four arrows pointing outward (up, down, left, right) from the disc edge.
    const arrowColor = "#000000";
    ctx.strokeStyle = arrowColor;
    ctx.fillStyle = arrowColor;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, cellSize * 0.06);
    const start = r * 1.02;
    const end = r * 1.5;
    const headLen = Math.max(2, cellSize * 0.11);
    const dirs = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ];
    for (const dir of dirs) {
      const sx = cx + dir.x * start;
      const sy = cy + dir.y * start;
      const ex = cx + dir.x * end;
      const ey = cy + dir.y * end;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // Arrowhead: two short strokes angled back from the tip (perpendicular).
      const px = -dir.y;
      const py = dir.x;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - dir.x * headLen + px * headLen * 0.6,
        ey - dir.y * headLen + py * headLen * 0.6,
      );
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - dir.x * headLen - px * headLen * 0.6,
        ey - dir.y * headLen - py * headLen * 0.6,
      );
      ctx.stroke();
    }

    // "?" glyph centered in the disc.
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.max(8, Math.round(cellSize * 0.5))}px sans-serif`;
    ctx.fillText("?", cx, cy + cellSize * 0.02);
    ctx.restore();
  }

  function getMoveQuality(score, allScores) {
    if (score == null || allScores.length === 0) return "not-evaluated";
    const maxScore = Math.max(...allScores);
    const minScore = Math.min(...allScores);
    const range = maxScore - minScore;
    if (range === 0) return "neutral";
    const normalized = (score - minScore) / range;
    if (normalized >= 0.8) return "best";
    if (normalized >= 0.5) return "good";
    if (normalized >= 0.2) return "neutral";
    return "bad";
  }

  function getScoreColor(score, allScores) {
    if (score == null || allScores.length === 0)
      return "rgba(100, 100, 100, 0.3)";
    const maxScore = Math.max(...allScores);
    const minScore = Math.min(...allScores);
    const range = maxScore - minScore;
    if (range === 0 || allScores.length === 1) {
      const hue = score > 0 ? 90 : score < 0 ? 0 : 60;
      return `hsla(${hue}, 70%, 50%, 0.3)`;
    }
    const normalized = (score - minScore) / range;
    const hue = normalized * 120;
    return `hsla(${hue}, 70%, 50%, 0.3)`;
  }

  function hexToRgb(hex) {
    let color = hex || "#888888";
    color = color.replace("#", "");
    if (color.length === 3)
      color = color
        .split("")
        .map((c) => c + c)
        .join("");
    return {
      r: parseInt(color.substring(0, 2), 16) || 136,
      g: parseInt(color.substring(2, 4), 16) || 136,
      b: parseInt(color.substring(4, 6), 16) || 136,
    };
  }

  function renderTerritoryBoundaries(
    ctx,
    territoryCells,
    snakeColorMap,
    boardHeight,
    cellSize,
    selectedSnake,
    bodyOwnerMap,
  ) {
    const ownerMap = {};
    Object.entries(territoryCells).forEach(([sid, cells]) => {
      if (!cells || cells.length === 0) return;
      cells.forEach((cell) => {
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
      const snakeColor = snakeColorMap[sid] || "#888888";
      const rgb = hexToRgb(snakeColor);
      const glowAlpha = selectedSnake === sid ? 0.6 : 0.45;

      cells.forEach((cell) => {
        const px = cell.x * cellSize;
        const py = (boardHeight - 1 - cell.y) * cellSize;

        const edges = [
          { dx: 0, dy: 1, dir: "top" },
          { dx: 0, dy: -1, dir: "bottom" },
          { dx: -1, dy: 0, dir: "left" },
          { dx: 1, dy: 0, dir: "right" },
        ];

        edges.forEach(({ dx, dy, dir }) => {
          if (!shouldDrawBoundary(sid, cell.x + dx, cell.y + dy)) return;
          let grad;
          switch (dir) {
            case "top":
              grad = ctx.createLinearGradient(px, py, px, py + glowDepth);
              grad.addColorStop(
                0,
                `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`,
              );
              grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
              ctx.fillStyle = grad;
              ctx.fillRect(px, py, cellSize, glowDepth);
              break;
            case "bottom":
              grad = ctx.createLinearGradient(
                px,
                py + cellSize,
                px,
                py + cellSize - glowDepth,
              );
              grad.addColorStop(
                0,
                `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`,
              );
              grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
              ctx.fillStyle = grad;
              ctx.fillRect(px, py + cellSize - glowDepth, cellSize, glowDepth);
              break;
            case "left":
              grad = ctx.createLinearGradient(px, py, px + glowDepth, py);
              grad.addColorStop(
                0,
                `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`,
              );
              grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
              ctx.fillStyle = grad;
              ctx.fillRect(px, py, glowDepth, cellSize);
              break;
            case "right":
              grad = ctx.createLinearGradient(
                px + cellSize,
                py,
                px + cellSize - glowDepth,
                py,
              );
              grad.addColorStop(
                0,
                `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`,
              );
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
      const snakeColor = snakeColorMap[sid] || "#888888";
      const alpha = selectedSnake === sid ? 1.0 : 0.85;
      ctx.strokeStyle = hexToRgba(snakeColor, alpha);
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "square";

      ctx.beginPath();
      cells.forEach((cell) => {
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
      ctx.lineCap = "butt";
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
      hasRight: neighbors.has(`${segment.x + 1},${segment.y}`),
    };
  }

  function renderSnakeUnified(ctx, snake, boardHeight, cellSize, options) {
    if (snake.body.length === 0) return;

    const snakeColor = snake.customizations?.color || snake.color || "#888888";
    const gap = getSnakeGap(cellSize);
    const pathNeighbors = buildPathNeighbors(snake);
    const selectionGlow = options?.selectionGlow || null;
    const isControlled = options?.isControlled || false;
    const invulnLevel = snake.invulnerabilityLevel || 0;
    // Ghost mode renders a dead snake using the exact same continuous body
    // shape as a live snake, but translucent and with a colored outline, so a
    // dead snake reads as the same creature, just faded out.
    const ghost = options?.ghost || false;

    const visited = new Set();
    const segments = [];
    for (let i = 0; i < snake.body.length; i++) {
      const segment = snake.body[i];
      const key = `${segment.x},${segment.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const conn = getCellConnections(segment, pathNeighbors);
      segments.push({ segment, conn, key });
    }

    if (selectionGlow) {
      const blurRadius = Math.max(6, cellSize * 0.5);
      ctx.save();
      ctx.filter = 'blur(' + blurRadius + 'px)';
      ctx.fillStyle = hexToRgba(selectionGlow, 1.0);
      for (let pass = 0; pass < 3; pass++) {
        ctx.beginPath();
        for (const { segment, conn } of segments) {
          const sx = segment.x * cellSize;
          const sy = (boardHeight - 1 - segment.y) * cellSize;
          ctx.rect(sx + gap, sy + gap, cellSize - 2 * gap, cellSize - 2 * gap);
          if (conn.hasRight) ctx.rect(sx + cellSize - gap - 1, sy + gap, gap + 1, cellSize - 2 * gap);
          if (conn.hasLeft)  ctx.rect(sx, sy + gap, gap + 1, cellSize - 2 * gap);
          if (conn.hasTop)   ctx.rect(sx + gap, sy, cellSize - 2 * gap, gap + 1);
          if (conn.hasBottom) ctx.rect(sx + gap, sy + cellSize - gap - 1, cellSize - 2 * gap, gap + 1);
        }
        ctx.fill();
      }
      ctx.filter = 'none';
      ctx.restore();
    }

    if (invulnLevel !== 0) {
      const outerExpand = Math.max(2, cellSize * 0.06);
      const outerColor =
        invulnLevel < 0 ? "rgba(255, 40, 40, 1)" : "rgba(40, 120, 255, 1)";
      const lineWidth = Math.max(2, cellSize * 0.08);
      ctx.save();
      ctx.strokeStyle = outerColor;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "square";

      for (const { segment, conn } of segments) {
        const sx = segment.x * cellSize;
        const sy = (boardHeight - 1 - segment.y) * cellSize;
        const left = (conn.hasLeft ? sx : sx + gap) - outerExpand;
        const right =
          (conn.hasRight ? sx + cellSize : sx + cellSize - gap) + outerExpand;
        const top = (conn.hasTop ? sy : sy + gap) - outerExpand;
        const bottom =
          (conn.hasBottom ? sy + cellSize : sy + cellSize - gap) + outerExpand;

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
          const cx = sx + cellSize - gap + outerExpand;
          const cy = sy + cellSize - gap + outerExpand;
          ctx.beginPath();
          ctx.moveTo(cx - 2 * outerExpand, cy);
          ctx.lineTo(cx, cy);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx, cy - 2 * outerExpand);
          ctx.lineTo(cx, cy);
          ctx.stroke();
        }
        if (conn.hasRight && conn.hasTop) {
          const cx = sx + cellSize - gap + outerExpand;
          const cy = sy + gap - outerExpand;
          ctx.beginPath();
          ctx.moveTo(cx - 2 * outerExpand, cy);
          ctx.lineTo(cx, cy);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy + 2 * outerExpand);
          ctx.stroke();
        }
        if (conn.hasLeft && conn.hasBottom) {
          const cx = sx + gap - outerExpand;
          const cy = sy + cellSize - gap + outerExpand;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + 2 * outerExpand, cy);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx, cy - 2 * outerExpand);
          ctx.lineTo(cx, cy);
          ctx.stroke();
        }
        if (conn.hasLeft && conn.hasTop) {
          const cx = sx + gap - outerExpand;
          const cy = sy + gap - outerExpand;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + 2 * outerExpand, cy);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy + 2 * outerExpand);
          ctx.stroke();
        }
      }
      ctx.lineCap = "butt";
      ctx.restore();
    }

    if (ghost) {
      // Dead snake: same continuous body shape as a live snake, but the solid
      // fill is replaced by diagonal stripes in the team color, slanted the
      // opposite way ("\") to the fertile-ground stripes ("/").
      ctx.save();
      ctx.beginPath();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const { segment, conn } of segments) {
        const sx = segment.x * cellSize;
        const sy = (boardHeight - 1 - segment.y) * cellSize;
        ctx.rect(sx + gap, sy + gap, cellSize - 2 * gap, cellSize - 2 * gap);
        if (conn.hasRight)
          ctx.rect(sx + cellSize - gap - 1, sy + gap, gap + 1, cellSize - 2 * gap);
        if (conn.hasLeft) ctx.rect(sx, sy + gap, gap + 1, cellSize - 2 * gap);
        if (conn.hasTop) ctx.rect(sx + gap, sy, cellSize - 2 * gap, gap + 1);
        if (conn.hasBottom)
          ctx.rect(sx + gap, sy + cellSize - gap - 1, cellSize - 2 * gap, gap + 1);
        if (sx < minX) minX = sx;
        if (sy < minY) minY = sy;
        if (sx + cellSize > maxX) maxX = sx + cellSize;
        if (sy + cellSize > maxY) maxY = sy + cellSize;
      }
      ctx.clip();
      const bh = maxY - minY;
      const bw = maxX - minX;
      ctx.strokeStyle = hexToRgba(snakeColor, 0.95);
      ctx.lineWidth = Math.max(1.5, cellSize / 7);
      const stripeSpacing = Math.max(4, cellSize / 3.5);
      for (let o = -bh; o <= bw; o += stripeSpacing) {
        ctx.beginPath();
        ctx.moveTo(minX + o, minY);
        ctx.lineTo(minX + o + bh, minY + bh);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.fillStyle = snakeColor;
      for (const { segment, conn } of segments) {
        const sx = segment.x * cellSize;
        const sy = (boardHeight - 1 - segment.y) * cellSize;
        ctx.fillRect(sx + gap, sy + gap, cellSize - 2 * gap, cellSize - 2 * gap);
        if (conn.hasRight)
          ctx.fillRect(
            sx + cellSize - gap - 1,
            sy + gap,
            gap + 1,
            cellSize - 2 * gap,
          );
        if (conn.hasLeft) ctx.fillRect(sx, sy + gap, gap + 1, cellSize - 2 * gap);
        if (conn.hasTop) ctx.fillRect(sx + gap, sy, cellSize - 2 * gap, gap + 1);
        if (conn.hasBottom)
          ctx.fillRect(
            sx + gap,
            sy + cellSize - gap - 1,
            cellSize - 2 * gap,
            gap + 1,
          );
      }
    }

    if (isControlled) {
      const innerInset = Math.max(1, cellSize * 0.04);
      const dashLen = Math.max(2, cellSize * 0.1);
      ctx.save();
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = Math.max(1.5, cellSize * 0.05);
      ctx.setLineDash([dashLen, dashLen]);
      ctx.lineCap = "square";

      for (const { segment, conn } of segments) {
        const sx = segment.x * cellSize;
        const sy = (boardHeight - 1 - segment.y) * cellSize;
        const left = (conn.hasLeft ? sx : sx + gap) + innerInset;
        const right =
          (conn.hasRight ? sx + cellSize : sx + cellSize - gap) - innerInset;
        const top = (conn.hasTop ? sy : sy + gap) + innerInset;
        const bottom =
          (conn.hasBottom ? sy + cellSize : sy + cellSize - gap) - innerInset;

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
      }
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
      ctx.restore();
    }
  }

  // Candidate labels: a snake candidate is labelled by its direction; a piece
  // candidate by its kind (stay / rotation) or its destination cell.
  function candidateLabel(candidate) {
    if (candidate.direction) return candidate.direction.toUpperCase();
    if (candidate.kind === "stay") return "STAY";
    if (candidate.kind === "rotate") return "ROTATE";
    if (candidate.position)
      return `(${candidate.position.x},${candidate.position.y})`;
    return String(candidate.move);
  }

  function processMoveEvaluations(
    moveEvaluations,
    safeMoves,
    head,
    chosenMove,
  ) {
    const moveState = {
      selectedMove: null,
      moves: {},
      safeMoves: safeMoves || [],
      territoryCells: {},
      selectedSnake: null,
    };

    let evaluationsArray = [];
    if (moveEvaluations) {
      if (Array.isArray(moveEvaluations)) {
        evaluationsArray = moveEvaluations;
      } else if (moveEvaluations.evaluations) {
        evaluationsArray = moveEvaluations.evaluations;
        moveState.territoryCells = moveEvaluations.territoryCells || {};
      }
    }

    const evaluationsMap = {};
    evaluationsArray.forEach((evalData) => {
      evaluationsMap[String(evalData.move)] = evalData;
    });

    // Candidate source. Snakes (direction-keyed rows, incl. every historic
    // row): the four directions with head-derived positions, whether or not
    // each was evaluated — the historic 4-way model, unchanged. Pieces
    // (destination-keyed rows): the evaluation rows ARE the candidates — the
    // unit's legal moves this turn, each carrying its numeric destination id
    // (`move`, the same value staging puts on the wire), its `dest` cell and
    // its stay/move/rotate kind.
    const destinationKeyed = evaluationsArray.some(
      (e) => e && (typeof e.move === "number" || (e.dest && typeof e.move !== "string")),
    );

    let candidates;
    if (destinationKeyed) {
      candidates = evaluationsArray.map((evalData) => ({
        key: String(evalData.move),
        move: evalData.move,
        direction: null,
        kind: evalData.kind || "move",
        position: evalData.dest || null,
        // Enumerated candidates are legal by construction — "safe" here means
        // exactly what safeMoves means for snakes: offerable.
        isSafe: true,
      }));
    } else {
      candidates = ["up", "down", "left", "right"].map((direction) => {
        let candidatePos = null;
        switch (direction) {
          case "up":
            candidatePos = { x: head.x, y: head.y + 1 };
            break;
          case "down":
            candidatePos = { x: head.x, y: head.y - 1 };
            break;
          case "left":
            candidatePos = { x: head.x - 1, y: head.y };
            break;
          case "right":
            candidatePos = { x: head.x + 1, y: head.y };
            break;
        }
        return {
          key: direction,
          move: direction,
          direction: direction,
          kind: "move",
          position: candidatePos,
          isSafe: moveState.safeMoves.includes(direction),
        };
      });
    }

    const chosenKey = chosenMove == null ? null : String(chosenMove);
    candidates.forEach((candidate) => {
      const evalData = evaluationsMap[candidate.key];
      moveState.moves[candidate.key] = {
        key: candidate.key,
        move: candidate.move,
        direction: candidate.direction,
        kind: candidate.kind,
        label: candidateLabel(candidate),
        position: candidate.position,
        positionKey: candidate.position
          ? `${candidate.position.x},${candidate.position.y}`
          : null,
        isSafe: candidate.isSafe,
        isChosen: candidate.key === chosenKey,
        isEvaluated: !!evalData,
        score: evalData?.score ?? null,
        breakdown: evalData?.breakdown ?? null,
        numStates: evalData?.numStates ?? null,
        displayScore: evalData?.score ?? (candidate.isSafe ? 0 : null),
        projectedTerritoryCells: evalData?.projectedTerritoryCells ?? null,
        projectedCellOwnership: evalData?.projectedCellOwnership ?? null,
        quality: null,
        color: null,
      };
    });

    // Position→candidate index for keyboard navigation: every non-stay
    // candidate keyed by its destination cell ("x,y"), plus the hold (stay)
    // candidate itself — so per-keypress lookups are O(1) instead of a scan
    // over the whole candidate set.
    moveState.candidatesByPosition = new Map();
    moveState.holdCandidate = null;
    Object.values(moveState.moves).forEach((m) => {
      if (m.kind === "stay") moveState.holdCandidate = m;
      else if (m.positionKey) moveState.candidatesByPosition.set(m.positionKey, m);
    });

    const scoredMoves = Object.values(moveState.moves).filter(
      (m) => m.displayScore != null,
    );
    const allScores = scoredMoves.map((m) => m.displayScore);

    Object.values(moveState.moves).forEach((move) => {
      if (move.displayScore != null && allScores.length > 0) {
        move.quality = getMoveQuality(move.displayScore, allScores);
        move.color = getScoreColor(move.displayScore, allScores);
      } else {
        move.quality = "not-evaluated";
        move.color = "rgba(100, 100, 100, 0.3)";
      }
    });

    return moveState;
  }

  function renderBoard(canvas, gameState, moveState, options) {
    const ctx = canvas.getContext("2d");
    const snakeId = options?.snakeId || null;
    const chosenMove = options?.chosenMove || null;
    const showChosenArrow = options?.showChosenArrow !== false;
    // Staged-move arrows draw whenever the caller supplies options.stagedMoves
    // — live play passes the broadcast map, and the history replay passes the
    // recorded per-turn command-state snapshot (same shape), so both render
    // through this one path. Read-only callers that want no staging
    // affordances simply pass none.

    if (!gameState || !gameState.board) return;

    const board = gameState.board;
    const cellSize = Math.min(
      canvas.width / board.width,
      canvas.height / board.height,
    );
    const boardW = board.width * cellSize;
    const boardH = board.height * cellSize;
    const turn = gameState.turn || 0;

    ctx.imageSmoothingEnabled = false;
    // Alpha hygiene: never inherit transparency from a previous draw pass
    // (e.g. an overlay that mutated globalAlpha without restoring it).
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#000000";
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

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, boardW - 2, boardH - 2);

    if (board.hazards && board.hazards.length > 0) {
      board.hazards.forEach((hazard) => {
        const x = hazard.x * cellSize;
        const y = (board.height - 1 - hazard.y) * cellSize;
        ctx.save();
        ctx.fillStyle = "#dc1e1e";
        ctx.fillRect(x, y, cellSize, cellSize);
        ctx.restore();
      });
    }

    if (board.fertileTiles && board.fertileTiles.length > 0) {
      board.fertileTiles.forEach((tile) => {
        const x = tile.x * cellSize;
        const y = (board.height - 1 - tile.y) * cellSize;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellSize, cellSize);
        ctx.clip();
        ctx.strokeStyle = "rgba(240, 198, 70, 0.85)";
        ctx.lineWidth = Math.max(1.5, cellSize / 7);
        const stripeSpacing = Math.max(4, cellSize / 3.5);
        for (let offset = 0; offset <= cellSize * 2; offset += stripeSpacing) {
          ctx.beginPath();
          ctx.moveTo(x + offset, y);
          ctx.lineTo(x + offset - cellSize, y + cellSize);
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    if (moveState) {
      let activeTerritoryForDisplay = moveState.territoryCells;
      if (
        moveState.selectedMove &&
        moveState.moves[moveState.selectedMove]?.projectedTerritoryCells
      ) {
        activeTerritoryForDisplay =
          moveState.moves[moveState.selectedMove].projectedTerritoryCells;
      }
      if (
        activeTerritoryForDisplay &&
        Object.keys(activeTerritoryForDisplay).length > 0
      ) {
        const snakeColorMap = {};
        const bodyOwnerMap = {};
        board.snakes.forEach((snake) => {
          snakeColorMap[snake.id] =
            snake.customizations?.color || snake.color || "#888888";
          snake.body.forEach((seg) => {
            bodyOwnerMap[`${seg.x},${seg.y}`] = snake.id;
          });
        });
        renderTerritoryBoundaries(
          ctx,
          activeTerritoryForDisplay,
          snakeColorMap,
          board.height,
          cellSize,
          moveState.selectedSnake,
          bodyOwnerMap,
        );
      }
    }

    if (moveState) {
      Object.values(moveState.moves).forEach((move) => {
        if (move.position && (move.isSafe || move.isEvaluated)) {
          const x = move.position.x * cellSize;
          const y = (board.height - 1 - move.position.y) * cellSize;
          ctx.fillStyle = move.color;
          ctx.fillRect(x, y, cellSize, cellSize);
          if (moveState.selectedMove === (move.key ?? move.direction)) {
            ctx.strokeStyle = "#9C27B0";
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
          }
        }
      });
    }

    board.food.forEach((food) => {
      const x = food.x * cellSize;
      const y = (board.height - 1 - food.y) * cellSize;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellSize, cellSize);
      ctx.clip();
      ctx.fillStyle = "#000000";
      const emojiSize = Math.max(cellSize * 0.7, 10);
      ctx.font = `${emojiSize}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("\u{1F383}", x + cellSize / 2, y + cellSize / 2);
      ctx.restore();
    });

    if (
      board.invulnerabilityPotions &&
      board.invulnerabilityPotions.length > 0
    ) {
      board.invulnerabilityPotions.forEach((potion) => {
        const x = potion.x * cellSize;
        const y = (board.height - 1 - potion.y) * cellSize;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellSize, cellSize);
        ctx.clip();
        if (_potionImage) {
          const pad = cellSize * 0.1;
          ctx.drawImage(
            _potionImage,
            x + pad,
            y + pad,
            cellSize - pad * 2,
            cellSize - pad * 2,
          );
        } else {
          const emojiSize = Math.max(cellSize * 0.7, 10);
          ctx.font = `${emojiSize}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("\u{1F9EA}", x + cellSize / 2, y + cellSize / 2);
        }
        ctx.restore();
      });
    }

    const controlledSnakeIds = options?.controlledSnakeIds || new Set();
    const selectionGlows = options?.selectionGlows || {};

    board.snakes.forEach((snake) => {
      const isControlled = controlledSnakeIds.has
        ? controlledSnakeIds.has(snake.id)
        : !!controlledSnakeIds[snake.id];
      const glowColor = selectionGlows[snake.id] || null;
      renderSnakeUnified(ctx, snake, board.height, cellSize, {
        selectionGlow: glowColor,
        isControlled: isControlled,
      });
    });

    // Staged-move lookup hoisted above the glyph pass: the head glyph needs
    // the staged rotation flag (pawn rotation badge) before the arrow block
    // reads the same map.
    const stagedMovesMap = options?.stagedMoves || {};

    board.snakes.forEach((snake) => {
      const stagedForThisSnake = stagedMovesMap[snake.id];
      const head = snake.body[0];
      if (head) {
        const hx = head.x * cellSize;
        const hy = (board.height - 1 - head.y) * cellSize;
        drawHeadGlyph(ctx, snake, hx, hy, cellSize, {
          stagedRotation: stagedForThisSnake?.rotation || null,
        });
        // Alive board snakes only — dead snakes render as ghosts/death
        // markers in a separate pass and never reach this loop.
        drawHealthBar(ctx, snake, hx, hy, cellSize);
      }

      if (turn > 0 && snake.body.length > 1) {
        const labelSize = Math.max(cellSize * 0.55, 10);

        const neck = snake.body[1];
        if (neck) {
          const nx = neck.x * cellSize + cellSize / 2;
          const ny = (board.height - 1 - neck.y) * cellSize + cellSize / 2;
          ctx.font = `${labelSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#000000";
          ctx.fillText(String(snake.body.length), nx, ny);
        }

        const willGrow =
          snake.body[snake.body.length - 1].x ===
            snake.body[snake.body.length - 2].x &&
          snake.body[snake.body.length - 1].y ===
            snake.body[snake.body.length - 2].y;
        if (willGrow) {
          const tail = snake.body[snake.body.length - 1];
          const tx = tail.x * cellSize + cellSize / 2;
          const ty = (board.height - 1 - tail.y) * cellSize + cellSize / 2;
          ctx.font = `${labelSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#000000";
          ctx.fillText("2", tx, ty);
        }
      }

      let arrowMove = null;
      let arrowColor = "#4CAF50";
      let arrowCommitted = false;
      // Replay styling (options.chosenMoveStyle):
      //   'submitted' (default)   — solid arrow: the move actually sent to the
      //                             game server (ground truth).
      //   'recommendation-only'   — dashed grey arrow: no submitted_move was
      //                             logged for this row, so the arrow shows the
      //                             bot's recommendation only.
      // options.secondaryMove — a thin dashed grey hint arrow for the bot's
      // recommendation when it differs from the submitted move.
      let arrowDashed = false;
      let secondaryMove = null;
      // Ghost arrow: the REQUESTED move whenever it differs from the
      // Firebase-confirmed staged move (`move`). Rendered dashed and
      // translucent in the same colour — the optimistic layer of the
      // requested → confirmed → final pipeline.
      let ghostMove = null;
      if (showChosenArrow && snake.id === snakeId && chosenMove) {
        arrowMove = chosenMove;
        if (options?.chosenMoveStyle === "recommendation-only") {
          arrowColor = "#9E9E9E";
          arrowDashed = true;
        }
        secondaryMove = options?.secondaryMove || null;
      } else if (stagedForThisSnake) {
        // `move` is the confirmed staged move (null until Firebase's first
        // confirmation for the turn lands); `requestedMove` is what was asked
        // for most recently. Chess pieces stage NUMERIC destination indices;
        // those draw the same arrow straight to the destination cell (one
        // long continuous arrow for sliders, a direct one for knight jumps).
        // A staged ROTATION doesn't translate the piece, so it draws the
        // rotation badge (drawHeadGlyph) instead of an arrow; a staged stay
        // resolves to the head cell and endpointFor drops it below.
        const rotationStaged = !!stagedForThisSnake.rotation;
        const arrowWorthy = (move) =>
          isDirectionMove(move) ||
          (typeof move === "number" && !rotationStaged);
        const confirmedMove = stagedForThisSnake.move;
        arrowMove = arrowWorthy(confirmedMove) ? confirmedMove : null;
        arrowColor = stagedForThisSnake.color || "#4CAF50";
        arrowCommitted = !!stagedForThisSnake.committed;
        const requested = stagedForThisSnake.requestedMove;
        if (arrowWorthy(requested) && requested !== arrowMove) {
          ghostMove = requested;
        }
      }
      if (arrowMove || ghostMove) {
        const shead = snake.body[0];
        if (shead) {
          const x = shead.x * cellSize;
          const y = (board.height - 1 - shead.y) * cellSize;
          const centerX = x + cellSize / 2;
          const centerY = y + cellSize / 2;
          const arrowLen = cellSize * 1.2;
          // Direction moves keep the fixed-length one-cell geometry; numeric
          // (piece) moves aim at the real destination cell's center, inset
          // toward the origin so the arrowhead doesn't cover the glyph there.
          // Returns null for a move with no drawable endpoint (stay = own
          // square, or an index outside the playable interior).
          const endpointFor = (move) => {
            if (isDirectionMove(move)) {
              let ex = centerX;
              let ey = centerY;
              switch (move) {
                case "up":
                  ey -= arrowLen;
                  break;
                case "down":
                  ey += arrowLen;
                  break;
                case "left":
                  ex -= arrowLen;
                  break;
                case "right":
                  ex += arrowLen;
                  break;
              }
              return { ex, ey };
            }
            const dest = moveDestinationCell(move, board);
            if (!dest) return null;
            if (dest.x === shead.x && dest.y === shead.y) return null; // stay
            const destX = dest.x * cellSize + cellSize / 2;
            const destY = (board.height - 1 - dest.y) * cellSize + cellSize / 2;
            const ang = Math.atan2(destY - centerY, destX - centerX);
            const inset = cellSize * 0.35;
            return {
              ex: destX - Math.cos(ang) * inset,
              ey: destY - Math.sin(ang) * inset,
            };
          };
          const drawArrow = (move, color, lineWidth, dashed, headScale, chevrons) => {
            const endpoint = endpointFor(move);
            if (!endpoint) return null;
            const { ex, ey } = endpoint;
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.setLineDash(dashed ? [lineWidth * 1.6, lineWidth * 1.4] : []);
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.setLineDash([]);
            const angle = Math.atan2(ey - centerY, ex - centerX);
            const headSize = Math.max(cellSize * 0.45, 18) * headScale;
            const drawHead = (tipX, tipY) => {
              ctx.beginPath();
              ctx.moveTo(tipX, tipY);
              ctx.lineTo(
                tipX - headSize * Math.cos(angle - Math.PI / 6),
                tipY - headSize * Math.sin(angle - Math.PI / 6),
              );
              ctx.lineTo(
                tipX - headSize * Math.cos(angle + Math.PI / 6),
                tipY - headSize * Math.sin(angle + Math.PI / 6),
              );
              ctx.closePath();
              ctx.fill();
            };
            drawHead(ex, ey);
            if (chevrons > 1) {
              const back = headSize * 0.7;
              drawHead(ex - back * Math.cos(angle), ey - back * Math.sin(angle));
            }
            return { ex, ey };
          };

          // Secondary bot-recommendation hint FIRST so the primary draws over it.
          if (secondaryMove && secondaryMove !== arrowMove) {
            drawArrow(secondaryMove, "#9E9E9E", Math.max(cellSize * 0.08, 3), true, 0.6, 1);
          }

          // Ghost arrow for the requested move: dashed + translucent, drawn
          // before the confirmed arrow so the solid state stays on top.
          if (ghostMove) {
            ctx.globalAlpha = 0.5;
            drawArrow(ghostMove, arrowColor, Math.max(cellSize * 0.12, 4), true, 0.8, 1);
            ctx.globalAlpha = 1;
          }

          // Confirmed and finalized arrows share the same color (grey for the
          // bot, the controller's color for a human). The ONLY visual
          // difference is the arrowhead count: a confirmed staged move draws
          // a single chevron, the turn's finalized move a double chevron.
          if (arrowMove) {
            drawArrow(
              arrowMove,
              arrowColor,
              Math.max(cellSize * 0.18, 6),
              arrowDashed,
              1,
              arrowCommitted ? 2 : 1,
            );
          }

          // Fatal-move warning: the staged/committed move walks the head into
          // certain death (wall, own body, or a non-severable enemy). The move
          // is NEVER auto-corrected — the server commits it verbatim — so we
          // mark the destination cell with a red ⃠ (no-entry circle + X) to warn
          // the human. We keep the arrow's source colour intact so the warning
          // is additive, not a replacement.
          // options.fatalConsented (replay): this turn's submitted move went
          // through the fatal-move confirmation dialog — flag it with the same
          // red no-entry marker so a deliberate death is visible in review.
          if ((stagedForThisSnake && stagedForThisSnake.fatal) || options?.fatalConsented) {
            // The fatal flag describes the REQUESTED move — anchor the marker
            // on the ghost arrow's destination when it differs.
            const fatalMove = ghostMove || arrowMove;
            let dcx = 0, dcy = 0;
            switch (fatalMove) {
              case "up": dcy = 1; break;
              case "down": dcy = -1; break;
              case "left": dcx = -1; break;
              case "right": dcx = 1; break;
            }
            const destCol = shead.x + dcx;
            const destRow = board.height - 1 - (shead.y + dcy);
            const mx = destCol * cellSize + cellSize / 2;
            const my = destRow * cellSize + cellSize / 2;
            const r = cellSize * 0.32;
            ctx.setLineDash([]);
            ctx.lineWidth = Math.max(cellSize * 0.1, 3);
            ctx.strokeStyle = "#ff1744";
            ctx.beginPath();
            ctx.arc(mx, my, r, 0, Math.PI * 2);
            ctx.stroke();
            const d = r * 0.6;
            ctx.beginPath();
            ctx.moveTo(mx - d, my - d);
            ctx.lineTo(mx + d, my + d);
            ctx.moveTo(mx + d, my - d);
            ctx.lineTo(mx - d, my + d);
            ctx.stroke();
          }
        }
      }
    });

    // Unit tags: a compact tag anchored at each unit's head cell (top-right)
    // carrying the unit's letter, weight, health, and operator name when
    // owned, with a colour-coded health bar underneath. Placement + hover
    // hit-testing live in renderUnitTags / getNameTagAt.
    renderUnitTags(ctx, canvas, board, cellSize, options);

    // Dead-head markers (drawn last so they sit on top of live snakes). This is
    // the SINGLE centralized death-rendering path shared by live play, /play
    // historic scrubbing, and /history. We build one unified list of death
    // entries, then derive each snake's authoritative final cell + intended
    // (staged) cell the same way for every consumer:
    //   - `actual` (solid marker): the server-decided final cell. Taken from an
    //     explicit actualHead (history: last-known head stepped by server_move)
    //     when present, else derived from the engine's authoritative `lastMoves`
    //     map (last-known head stepped one cell in the recorded direction). Same
    //     source for our snakes and enemies.
    //   - `intended` (shadow marker): the move we actually submitted. Taken from
    //     an explicit intendedHead (history: last-known head stepped by
    //     submitted_move) when present, else the `submittedMoves` map (live:
    //     client-tracked committed move), else the staged-move map. Only drawn
    //     when it differs from the server-decided cell.
    //   - When neither an explicit actualHead nor `lastMoves` is available
    //     (older logs, or the game's terminal move with no following state),
    //     fall back to the "unknown ?" marker at the last-known head.
    const ourDeaths = options?.ourDeaths || [];
    const excludeIds = new Set(
      ourDeaths.map((d) => d.id).filter((id) => id != null),
    );
    let deadSnakes = options?.deadSnakes || null;
    if (!deadSnakes && options?.previousBoard) {
      deadSnakes = getDisappearedSnakes(
        options.previousBoard.snakes,
        board.snakes,
        excludeIds,
      );
    }
    // The authoritative move map rides along on the rendered game state (it is
    // logged inside game_state JSONB, so historic scrubbing and /history get it
    // for free); an explicit option can override it.
    const lastMoves = options?.lastMoves || gameState?.lastMoves || null;
    const stagedMovesForDeaths = options?.stagedMoves || null;
    // Live: the client tracks the move it actually committed per snake ({id: move}).
    // A dead snake is gone from the server's staged-move broadcast, so this map is
    // the only source for its intended (ghost) cell.
    const submittedMovesForDeaths = options?.submittedMoves || null;

    const deathEntries = [];
    if (deadSnakes) {
      deadSnakes.forEach((d) => {
        deathEntries.push({
          id: d.id,
          lastHead: d.head,
          body: d.body,
          color: d.color,
          intendedHead: undefined,
          actualHead: undefined,
        });
      });
    }
    ourDeaths.forEach((d) => {
      deathEntries.push({
        id: d.id,
        lastHead: d.lastHead || d.intendedHead || null,
        body: d.body || null,
        color: d.color,
        intendedHead: d.intendedHead,
        actualHead: d.actualHead,
      });
    });

    deathEntries.forEach((d) => {
      // Ghosted last-known body so the dead snake still reads on the board.
      if (d.body)
        renderSnakeUnified(
          ctx,
          { body: d.body, color: d.color },
          board.height,
          cellSize,
          { ghost: true },
        );

      // Authoritative final cell: explicit override first, else lastMoves.
      let actual = d.actualHead || null;
      if (!actual && lastMoves && d.id != null && d.lastHead) {
        actual = applyDirection(d.lastHead, lastMoves[d.id]);
      }
      // Intended/submitted cell: explicit override first, else the live
      // committed-move map, else the staged-move map.
      let intended = d.intendedHead || null;
      if (!intended && submittedMovesForDeaths && d.id != null && d.lastHead) {
        const submitted = submittedMovesForDeaths[d.id];
        if (submitted) {
          intended = applyDirection(d.lastHead, submitted);
        }
      }
      if (!intended && stagedMovesForDeaths && d.id != null && d.lastHead) {
        const staged = stagedMovesForDeaths[d.id];
        if (staged && staged.move) {
          intended = applyDirection(d.lastHead, staged.move);
        }
      }

      const same =
        intended &&
        actual &&
        intended.x === actual.x &&
        intended.y === actual.y;
      if (intended && !same) {
        drawDeathMarker(ctx, intended, board.height, cellSize, d.color, true);
      }
      if (actual) {
        // Authoritative final head → solid marker.
        drawDeathMarker(ctx, actual, board.height, cellSize, d.color, false);
      } else {
        // No authoritative final position (older logs / no lastMoves) → "?"
        // marker at the last-known head.
        drawUnknownDeathMarker(
          ctx,
          d.lastHead || intended,
          board.height,
          cellSize,
          d.color,
        );
      }
    });

    return cellSize;
  }

  // Per-canvas unit-tag rects from the last render, for hover hit-testing.
  // Rects are in BOARD-PIXEL space (the canvas's internal coordinate system).
  const _nameTagRects = new WeakMap();

  // Draw ONE unit tag: a rounded white pill anchored at the unit's head cell,
  // containing (left to right) the unit's LETTER in a team-coloured chip, its
  // WEIGHT (×N — body length for snakes, stack weight for pieces), its
  // numeric HEALTH behind a heart tinted by the shared health thresholds, and
  // the OPERATOR name when the unit is owned. A colour-coded health bar
  // (healthFraction/healthBarColor — same thresholds as the board bars) sits
  // directly under the tag.
  // The whole tag is one atomic unit: the opacity is computed once from the
  // tag's state and applied to every part inside a single save/restore block,
  // so no piece can appear/disappear independently and no alpha can leak.
  // Display model (Alt-tap toggle, plumbed through
  // options.tagsHiddenByDefault):
  //   shown-by-default  → every tag renders; hovering a tag/unit fades THAT
  //                       tag translucent so the board under it stays readable.
  //   hidden-by-default → tags don't render at all; only the hovered unit's
  //                       tag is drawn (solid), placed by renderUnitTags so it
  //                       never covers the hovered cell.
  function drawUnitTag(ctx, tag, state) {
    const {
      rect,
      fontSize,
      font,
      padX,
      gap,
      chipW,
      tagH,
      barH,
      letter,
      weightText,
      health,
      frac,
      nameText,
      unitColor,
      ownerColor,
    } = tag;
    const { selected, hovered, hiddenDefault } = state;
    let alpha;
    if (hiddenDefault) alpha = 0.95; // the hover-shown tag (others aren't drawn)
    else if (hovered) alpha = 0.35;
    else alpha = selected ? 1 : 0.9;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = "middle";

    // Tag body: white background, outlined in the owning player's colour
    // when owned, else the unit's own colour; the selected unit gets a
    // thicker outline.
    const r = tagH * 0.3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.w, tagH, r);
    else ctx.rect(rect.x, rect.y, rect.w, tagH);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = selected ? Math.max(2, fontSize * 0.2) : 1.5;
    ctx.strokeStyle = ownerColor || unitColor;
    ctx.stroke();

    const midY = rect.y + tagH / 2 + fontSize * 0.05;
    let x = rect.x + padX;

    // Letter chip in the unit's colour (white bold letter on top).
    const chipH = tagH - Math.max(2, fontSize * 0.25);
    const chipY = rect.y + (tagH - chipH) / 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, chipY, chipW, chipH, chipH * 0.25);
    else ctx.rect(x, chipY, chipW, chipH);
    ctx.fillStyle = unitColor;
    ctx.fill();
    ctx.font = `700 ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(letter, x + chipW / 2, midY);
    x += chipW + gap;

    // Weight (×N).
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(weightText, x, midY);
    x += ctx.measureText(weightText).width;

    // Numeric health, heart tinted by the shared health thresholds.
    if (health != null) {
      x += gap;
      ctx.fillStyle = healthBarColor(frac);
      ctx.fillText("\u2665", x, midY);
      x += ctx.measureText("\u2665").width + fontSize * 0.15;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillText(String(health), x, midY);
      x += ctx.measureText(String(health)).width;
    }

    // Operator name when owned.
    if (nameText) {
      x += gap;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillText(nameText, x, midY);
    }

    // Colour-coded health bar directly under the tag (same thresholds as the
    // on-cell board bars).
    if (barH) {
      const by = rect.y + tagH + 1;
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(rect.x, by, rect.w, barH);
      if (frac > 0) {
        ctx.fillStyle = healthBarColor(frac);
        ctx.fillRect(rect.x, by, rect.w * frac, barH);
      }
    }
    ctx.restore();
  }

  // One tag per unit head cell, for EVERY unit on the board (owned or not) —
  // the generalization of the old owner name tags. Anchored at the head
  // cell's TOP-RIGHT corner; candidate placements (top-right primary, then
  // top-left / bottom-right fallbacks) are scored by how many OTHER unit
  // heads and already-placed tags they cover, and the least-overlapping
  // candidate wins. Styling derives reactively from the selections map; the
  // Alt-tap display default arrives via options.tagsHiddenByDefault.
  // When tags are hidden by default, ONLY the hovered unit's tag renders,
  // anchored to a spot adjacent to the head that never covers the hovered
  // cell (options.hoverCell) — the cell under the cursor must stay fully
  // visible and clickable for destination selection / inspection.
  function renderUnitTags(ctx, canvas, board, cellSize, options) {
    const rects = [];
    _nameTagRects.set(canvas, rects);
    const owners = options?.owners || {};
    const selections = options?.selections || {};
    const hoveredId = options?.hoveredUnitId || null;
    const hiddenDefault = !!options?.tagsHiddenByDefault;
    // The board cell under the cursor, as a board-pixel rect: hover-shown
    // tags must never intersect it.
    const hoverCell = options?.hoverCell || null;
    const cursorRect = hoverCell
      ? {
          x: hoverCell.x * cellSize,
          y: (board.height - 1 - hoverCell.y) * cellSize,
          w: cellSize,
          h: cellSize,
        }
      : null;

    // Other units' head cells (board-pixel rects) for overlap avoidance.
    const headRects = {};
    board.snakes.forEach((s) => {
      const h = s.body && s.body[0];
      if (h) {
        headRects[s.id] = {
          x: h.x * cellSize,
          y: (board.height - 1 - h.y) * cellSize,
          w: cellSize,
          h: cellSize,
        };
      }
    });
    const intersects = (a, b) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const placed = [];

    board.snakes.forEach((snake) => {
      const head = snake.body && snake.body[0];
      if (!head) return;
      const hovered = hoveredId === snake.id;
      // Hidden-by-default: nothing renders except the hovered unit's tag.
      if (hiddenDefault && !hovered) return;
      const owner = owners[snake.id] || null;
      const selected = !!selections[snake.id];
      const unitColor =
        snake.customizations?.color || snake.color || "#888888";

      // Letter for verbal reference; historic pre-letter units fall back to
      // their emoji, then "?".
      const letter = snake.letter || snake.emoji || "?";
      const weight = snake.length ?? snake.body.length;
      const health = typeof snake.health === "number" ? snake.health : null;
      const frac = health != null ? healthFraction(snake) : 0;

      const fontSize = Math.max(9, cellSize * 0.32);
      const font = `${selected ? "600" : "400"} ${fontSize}px sans-serif`;
      const padX = fontSize * 0.4;
      const gap = fontSize * 0.4;
      const weightText = `\u00d7${weight}`;
      const nameText = owner && owner.name ? owner.name : null;

      ctx.save();
      ctx.font = `700 ${fontSize}px sans-serif`;
      const chipW = Math.max(
        fontSize * 1.25,
        ctx.measureText(letter).width + fontSize * 0.5,
      );
      ctx.font = font;
      let contentW = chipW + gap + ctx.measureText(weightText).width;
      if (health != null) {
        contentW +=
          gap +
          ctx.measureText("\u2665").width +
          fontSize * 0.15 +
          ctx.measureText(String(health)).width;
      }
      if (nameText) contentW += gap + ctx.measureText(nameText).width;
      ctx.restore();

      const tagW = contentW + padX * 2;
      const tagH = fontSize * 1.5;
      const barH = health != null ? Math.max(2, fontSize * 0.3) : 0;
      const totalH = tagH + (barH ? barH + 1 : 0);

      // Anchor at the head cell's TOP-RIGHT corner, extending up-right with a
      // slight overlap into the cell so the association stays unambiguous.
      const hxLeft = head.x * cellSize;
      const hyTop = (board.height - 1 - head.y) * cellSize;
      const hxRight = hxLeft + cellSize;
      const overlap = cellSize * 0.18;
      // A hover-shown tag (hidden-by-default mode) must never cover the cell
      // the mouse is on: use anchors fully OUTSIDE the head cell, ringed
      // around it, and hard-filter any placement that intersects the cursor
      // cell below. The shown-by-default tags keep the head-overlapping
      // anchors (association reads better and hover already fades them).
      const avoidCursor = hiddenDefault && hovered && !!cursorRect;
      const pad = Math.max(2, cellSize * 0.06);
      const candidates = avoidCursor
        ? [
            { x: hxRight + pad, y: hyTop - totalH - pad }, // outside top-right
            { x: hxLeft - tagW - pad, y: hyTop - totalH - pad }, // outside top-left
            { x: hxLeft + (cellSize - tagW) / 2, y: hyTop - totalH - pad }, // above
            { x: hxRight + pad, y: hyTop + (cellSize - totalH) / 2 }, // right
            { x: hxLeft - tagW - pad, y: hyTop + (cellSize - totalH) / 2 }, // left
            { x: hxRight + pad, y: hyTop + cellSize + pad }, // outside bottom-right
            { x: hxLeft - tagW - pad, y: hyTop + cellSize + pad }, // outside bottom-left
            { x: hxLeft + (cellSize - tagW) / 2, y: hyTop + cellSize + pad }, // below
          ]
        : [
            { x: hxRight - overlap, y: hyTop - totalH + overlap }, // top-right
            { x: hxLeft - tagW + overlap, y: hyTop - totalH + overlap }, // top-left
            { x: hxRight - overlap, y: hyTop + cellSize - overlap }, // bottom-right
          ];

      const boardW = board.width * cellSize;
      const boardH = board.height * cellSize;
      let best = null;
      let bestScore = Infinity;
      // Last resort when EVERY candidate would touch the cursor cell (tiny
      // boards): the least-overlapping placement, cursor be damned — a tag
      // still beats no tag.
      let fallback = null;
      let fallbackScore = Infinity;
      for (const c of candidates) {
        const rect = {
          x: Math.max(1, Math.min(c.x, boardW - tagW - 1)),
          y: Math.max(1, Math.min(c.y, boardH - totalH - 1)),
          w: tagW,
          h: totalH,
        };
        let score = 0;
        for (const [sid, hr] of Object.entries(headRects)) {
          if (sid === snake.id) continue;
          if (intersects(rect, hr)) score++;
        }
        for (const pr of placed) {
          if (intersects(rect, pr)) score++;
        }
        // The cursor-cell constraint is HARD for hover-shown tags: the board
        // clamp above can push an outside anchor back over the hovered cell,
        // so it must be re-checked on the final rect, not the raw anchor.
        if (avoidCursor && intersects(rect, cursorRect)) {
          if (score < fallbackScore) {
            fallbackScore = score;
            fallback = rect;
          }
          continue;
        }
        if (score < bestScore) {
          bestScore = score;
          best = rect;
        }
        if (score === 0) break;
      }
      if (!best) best = fallback;
      if (!best) return;

      drawUnitTag(
        ctx,
        {
          rect: best,
          fontSize,
          font,
          padX,
          gap,
          chipW,
          tagH,
          barH,
          letter,
          weightText,
          health,
          frac,
          nameText,
          unitColor,
          ownerColor: owner && owner.color ? owner.color : null,
        },
        { selected, hovered, hiddenDefault },
      );

      placed.push(best);
      rects.push({ snakeId: snake.id, ...best });
    });
  }

  // Hit-test a mouse event against the unit-tag rects from the last render.
  // Returns the unit's snake id, or null. Uses the CSS-displayed size so it
  // stays correct when the canvas is scaled (same principle as getClickedCell).
  function getNameTagAt(canvas, event) {
    const rects = _nameTagRects.get(canvas);
    if (!rects || rects.length === 0) return null;
    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / bounds.width;
    const scaleY = canvas.height / bounds.height;
    const px = (event.clientX - bounds.left) * scaleX;
    const py = (event.clientY - bounds.top) * scaleY;
    for (const r of rects) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        return r.snakeId;
      }
    }
    return null;
  }

  function createBoardOverlay(
    overlayEl,
    canvas,
    board,
    moveState,
    onCellClick,
  ) {
    overlayEl.innerHTML = "";
    const displayWidth = canvas.clientWidth || canvas.width;
    const displayHeight = canvas.clientHeight || canvas.height;
    overlayEl.style.width = displayWidth + "px";
    overlayEl.style.height = displayHeight + "px";
    overlayEl.style.left = canvas.offsetLeft + "px";
    overlayEl.style.top = canvas.offsetTop + "px";
    const displayCellSize = Math.min(
      displayWidth / board.width,
      displayHeight / board.height,
    );

    Object.values(moveState.moves).forEach((move) => {
      if (!move.position) return;
      const button = document.createElement("button");
      button.className = "cell-button";
      if (move.isSafe) button.className += " candidate";
      if (moveState.selectedMove === (move.key ?? move.direction))
        button.className += " selected";

      const x = move.position.x * displayCellSize;
      const y = (board.height - 1 - move.position.y) * displayCellSize;
      button.style.left = x + "px";
      button.style.top = y + "px";
      button.style.width = displayCellSize + "px";
      button.style.height = displayCellSize + "px";
      button.style.zIndex = "10";

      // Input is owned by the page's delegated pointerdown handler; callers
      // that pass no handler get a presentational overlay whose teardown can
      // never swallow an interaction.
      if (onCellClick) {
        button.onclick = (e) => {
          e.stopPropagation();
          onCellClick(move.key ?? move.direction, e);
        };
      } else {
        button.style.cursor = 'pointer';
      }
      const scoreText =
        move.score != null
          ? move.score.toFixed(2)
          : move.isSafe
            ? "0.00"
            : "N/A";
      const label = move.label ?? move.direction.toUpperCase();
      button.title = `${label} - Score: ${scoreText}`;
      overlayEl.appendChild(button);
    });
  }

  // Single source of truth for team identity on the client, mirroring the
  // server-side TeamDetector rule: teamID → squad → color → snake id.
  function getTeamKey(snake) {
    if (!snake) return "";
    return snake.teamID || snake.squad || snake.customizations?.color || snake.color || snake.id;
  }

  // Turns a raw game-server team id like "team_red" into a friendly label
  // ("Team Red"). Returns null when there's nothing usable.
  function prettifyTeamName(teamId) {
    if (!teamId || !String(teamId).trim()) return null;
    return String(teamId)
      .trim()
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // Friendly display name for a team given one of its snakes: game-server team
  // name first, then squad, then color, then a generic fallback.
  function teamDisplayName(snake) {
    return (
      prettifyTeamName(snake?.teamID) ||
      snake?.squad ||
      snake?.customizations?.color ||
      snake?.color ||
      "Team"
    );
  }

  // Builds the HTML for one snake row. `opts` controls history-viewer extras:
  // selectable (clickable to switch perspective) and active (current
  // perspective). Without opts it renders the plain play-page row.
  function renderSnakeInfoItem(snake, ourSnakeId, opts, currentTurn) {
    const isOurSnake = snake.id === ourSnakeId;
    const isDead = !!(opts && opts.dead);
    const snakeColor = snake.customizations?.color || snake.color || "#888888";
    const invulnLevel = snake.invulnerabilityLevel || 0;
    let invulnDisplay = "";
    if (invulnLevel !== 0) {
      const icon = invulnLevel > 0 ? "\u{1F6E1}\uFE0F" : "\u26A0\uFE0F";
      // Turns remaining (inclusive of the current turn) from the absolute expiry
      // turn supplied by the server. Falls back to just the level when the expiry
      // is missing (older logs) or already passed at the displayed turn.
      const expiry = snake.invulnerabilityExpiryTurn;
      let turnsSuffix = "";
      if (typeof expiry === "number" && typeof currentTurn === "number") {
        const remaining = expiry - currentTurn + 1;
        if (remaining >= 1) turnsSuffix = ` \u00B7 ${remaining}t`;
      }
      invulnDisplay = `<span>${icon} ${invulnLevel}${turnsSuffix}</span>`;
    }
    // Historical replays predating letters stored an emoji head glyph; the
    // letter is already the suffix of a current snake's name, so only the
    // emoji era needs a prefix.
    const glyphPrefix = !snake.letter && snake.emoji ? `${snake.emoji} ` : "";
    // Owner badge: shown for owned snakes in the owning player's colour.
    const owner = opts && opts.owner;
    const ownerBadge = owner
      ? `<span style="border:1px solid ${owner.color};color:${owner.color};padding:1px 6px;border-radius:8px;font-weight:400;">${owner.name}</span>`
      : "";
    const selectable = opts && opts.selectable;
    const active = opts && opts.active;
    const itemClass =
      "snake-info-item" +
      (selectable ? " selectable" : "") +
      (active ? " active-perspective" : "");
    const styleParts = [];
    if (selectable) styleParts.push("cursor:pointer;");
    if (isDead) styleParts.push("opacity:0.45;filter:grayscale(0.6);");
    const clickAttr =
      (selectable ? ` data-select-snake="${snake.id}"` : "") +
      (styleParts.length ? ` style="${styleParts.join("")}"` : "");
    const deadSuffix = isDead
      ? ' <span style="color:#aaa;font-weight:400;">(dead)</span>'
      : "";
    // Inline health readout: the same red/orange/green bar as the board cell
    // (fraction of the unit's configured maxHealth) plus the raw number.
    // Skipped for dead rows and for historical rows without a health value.
    let healthDisplay = "";
    if (!isDead && typeof snake.health === "number") {
      const frac = healthFraction(snake);
      const fill =
        frac > 0
          ? `<span style="display:block;width:${(frac * 100).toFixed(1)}%;height:100%;background:${healthBarColor(frac)};"></span>`
          : "";
      healthDisplay =
        `<span style="display:inline-flex;align-items:center;gap:4px;">` +
        `<span style="display:inline-block;width:48px;height:8px;background:rgba(0,0,0,0.35);border:1px solid rgba(0,0,0,0.25);border-radius:4px;overflow:hidden;">${fill}</span>` +
        `${snake.health}</span>`;
    }
    // Unit icon: the SAME drawn icon as the unit's board head glyph
    // (unitIconSVG shares its path data with drawUnitIcon), rendered white on
    // the unit's colour box so the row reads like the board cell — including
    // the wire-facing rotation (opts.facing). Dead rows carry no facing and
    // draw unrotated.
    const facing = (opts && opts.facing) || null;
    const rotationDeg = facing ? (facingRotationRad(facing) * 180) / Math.PI : 0;
    const unitIcon = unitIconSVG(snake.unitType || "snake", 14, rotationDeg);
    // Weight: the unit-generic size stat — body length for snakes, stack
    // weight for pieces.
    const weight = snake.length ?? snake.body.length;
    return `
        <div class="${itemClass}"${clickAttr}>
          <div class="snake-color-box" style="background-color: ${snakeColor}; display: flex; align-items: center; justify-content: center;">${unitIcon}</div>
          <div class="snake-details">
            <div class="snake-name">${glyphPrefix}${snake.name}${isOurSnake ? " (You)" : ""}${deadSuffix}</div>
            <div class="snake-id" style="font-size: 0.75em; color: #888; margin-top: 1px;">${snake.id}</div>
            <div class="snake-stats">
              <span title="Weight">\u2696\uFE0F ${weight}</span>
              ${healthDisplay}
              ${invulnDisplay}
              ${ownerBadge}
            </div>
          </div>
        </div>
      `;
  }

  // Renders the participants list. With options.groupByTeam the snakes are
  // grouped by team (our team first and visually distinguished), and our team's
  // snakes are made selectable via options.onSelectSnake so the history viewer
  // can switch perspective. Without options it falls back to the flat list used
  // by the live play page.
  function renderSnakeInfo(container, gameState, ourSnakeId, options) {
    if (!gameState || !gameState.board) {
      container.innerHTML = "";
      return;
    }
    // Snake ownership map ({snakeId: {userId, name, color}}) for owner badges.
    const ownersMap = (options && options.owners) || {};
    const snakes = gameState.board.snakes;
    const currentTurn = gameState.turn;
    // Dead snakes (options.deadSnakes) are appended to their team groups so the
    // roster always shows every snake ever seen, greyed out with final length.
    const boardIds = new Set(snakes.map((s) => s.id));
    const deadSnakes = ((options && options.deadSnakes) || []).filter(
      (s) => !boardIds.has(s.id),
    );
    const deadIds = new Set(deadSnakes.map((s) => s.id));
    const allSnakes = snakes.concat(deadSnakes);
    // Facing for the row icons: the unit's wire facing, the same vector that
    // rotates its board head glyph. Dead units carry no facing.
    const facingFor = (snake) => (deadIds.has(snake.id) ? null : snake.facing);

    if (!options || !options.groupByTeam) {
      container.innerHTML = allSnakes
        .map((snake) =>
          renderSnakeInfoItem(
            snake, ourSnakeId,
            { dead: deadIds.has(snake.id), owner: ownersMap[snake.id] || null,
              facing: facingFor(snake) },
            currentTurn,
          ),
        )
        .join("");
      return;
    }

    // Group snakes by team key.
    const teams = new Map();
    for (const snake of allSnakes) {
      const key = getTeamKey(snake);
      if (!teams.has(key)) teams.set(key, []);
      teams.get(key).push(snake);
    }

    const selectableIds = options.selectableSnakeIds || null;
    const canSelect = !!options.onSelectSnake;
    // Identify our team even when there is no perspective snake set (e.g. live
    // play with nothing selected yet) by falling back to any selectable snake.
    const ourSnake =
      allSnakes.find((s) => s.id === ourSnakeId) ||
      (selectableIds ? allSnakes.find((s) => selectableIds.has(s.id)) : null);
    const ourTeamKey = ourSnake ? getTeamKey(ourSnake) : null;

    // Our team first, then enemy teams.
    const orderedKeys = Array.from(teams.keys()).sort((a, b) => {
      if (a === ourTeamKey) return -1;
      if (b === ourTeamKey) return 1;
      return 0;
    });

    const html = orderedKeys
      .map((key) => {
        const teamSnakes = teams.get(key);
        const isOurTeam = key === ourTeamKey;
        const teamColor =
          teamSnakes[0].customizations?.color ||
          teamSnakes[0].color ||
          "#888888";
        const name = teamDisplayName(teamSnakes[0]);
        const label = isOurTeam ? `${name} (Our Team)` : name;
        const headerClass = isOurTeam
          ? "team-group-header our-team"
          : "team-group-header enemy-team";
        const items = teamSnakes
          .map((snake) =>
            renderSnakeInfoItem(snake, ourSnakeId, {
              selectable:
                canSelect &&
                isOurTeam &&
                (selectableIds ? selectableIds.has(snake.id) : !deadIds.has(snake.id)),
              active: snake.id === ourSnakeId,
              dead: deadIds.has(snake.id),
              owner: ownersMap[snake.id] || null,
              facing: facingFor(snake),
            }, currentTurn),
          )
          .join("");
        return `
        <div class="team-group ${isOurTeam ? "our-team" : "enemy-team"}">
          <div class="${headerClass}">
            <span class="team-group-swatch" style="background-color:${teamColor};"></span>
            <span>${label}</span>
          </div>
          ${items}
        </div>
      `;
      })
      .join("");

    container.innerHTML = html;

    if (options.onSelectSnake) {
      container.querySelectorAll("[data-select-snake]").forEach((el) => {
        el.addEventListener("click", () => {
          options.onSelectSnake(el.getAttribute("data-select-snake"));
        });
      });
    }
  }

  function renderMoveButtons(container, moveState, onMoveClick) {
    const buttonLayout = [null, "up", null, "left", "down", "right"];

    container.innerHTML = buttonLayout
      .map((direction) => {
        if (!direction) {
          return '<div style="grid-column: span 1;"></div>';
        }
        const move = moveState.moves[direction];
        if (!move) return "";

        let classes = ["move-button"];
        if (move.isChosen) classes.push("chosen");
        if (moveState.selectedMove === direction) classes.push("selected");

        const scoreText =
          move.score != null
            ? `Score: ${move.score.toFixed(2)}`
            : move.isSafe
              ? "Score: 0.00"
              : "Not evaluated";

        const bgColor = move.color || "rgba(100, 100, 100, 0.3)";
        const solidColor = bgColor.replace("0.3)", "0.8)");

        return `
        <button class="${classes.join(" ")}"
                onclick="BoardRenderer._moveClickHandler('${direction}')"
                style="background: ${solidColor};">
          ${direction.toUpperCase()} ${move.isChosen ? "\u2713" : ""}
          <span class="score">${scoreText}</span>
        </button>
      `;
      })
      .join("");

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
    // Key-presence-driven rows: a breakdown carrying no heuristic keys at all
    // (no stats, empty weights/weighted tables — the piece stub evaluator's
    // shape) renders a genuinely EMPTY table through this same component.
    // Every real snake breakdown carries keys and renders exactly as before.
    const hasBreakdownKeys =
      Object.keys(breakdown).some(
        (k) => k !== "weights" && k !== "weighted" && k !== "stats",
      ) ||
      Object.keys(breakdown.weights || {}).length > 0 ||
      Object.keys(breakdown.weighted || {}).length > 0;
    if (!hasBreakdownKeys) {
      tbody.innerHTML = "";
      return;
    }
    const candidateMoves = Object.values(moveState.moves).filter(
      (m) => m.isEvaluated || m.isSafe,
    );
    const averageWeighted = {};

    if (candidateMoves.length > 0) {
      const weightedSums = {
        myLengthScore: 0,
        myTerritoryScore: 0,
        myControlledFoodScore: 0,
        myControlledFertileScore: 0,
        teamLengthScore: 0,
        teamTerritoryScore: 0,
        teamControlledFoodScore: 0,
        foodProximityScore: 0,
        foodEatenScore: 0,
        enemyTerritoryScore: 0,
        enemyLengthScore: 0,
        edgePenaltyScore: 0,
        selfSpaceScore: 0,
        alliesEnoughSpaceScore: 0,
        opponentsEnoughSpaceScore: 0,
        killsScore: 0,
        deathsScore: 0,
        enemyH2HRiskScore: 0,
        allyH2HRiskScore: 0,
        enemyPieceThreatScore: 0,
        allyPieceThreatScore: 0,
        gotoProgressScore: 0,
        nearProgressScore: 0,
        aggressionScore: 0,
        trappedScore: 0,
        fertileScore: 0,
      };

      candidateMoves.forEach((candidateMove) => {
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
      if (typeof value === "number") {
        if (Number.isInteger(value)) return value.toString();
        return value.toFixed(2);
      }
      return value;
    }

    const metricsConfig = [
      {
        name: "My Length",
        value: breakdown.myLength ?? 0,
        weight: breakdown.weights?.myLength ?? 10,
        weightedScore: breakdown.weighted?.myLengthScore ?? 0,
        averageWeighted: averageWeighted.myLengthScore ?? 0,
      },
      {
        name: "My Territory",
        value: breakdown.myTerritory ?? 0,
        weight: breakdown.weights?.myTerritory ?? 1,
        weightedScore: breakdown.weighted?.myTerritoryScore ?? 0,
        averageWeighted: averageWeighted.myTerritoryScore ?? 0,
      },
      {
        name: "My Controlled Food",
        value: breakdown.myControlledFood ?? breakdown.myFoodCount ?? 0,
        weight: breakdown.weights?.myControlledFood ?? 10,
        weightedScore: breakdown.weighted?.myControlledFoodScore ?? 0,
        averageWeighted: averageWeighted.myControlledFoodScore ?? 0,
      },
      {
        name: "My Fertile Ground",
        value: breakdown.myControlledFertile ?? 0,
        weight: breakdown.weights?.myControlledFertile ?? 2,
        weightedScore: breakdown.weighted?.myControlledFertileScore ?? 0,
        averageWeighted: averageWeighted.myControlledFertileScore ?? 0,
      },
      {
        name: "Team Length",
        value: breakdown.teamLength ?? 0,
        weight: breakdown.weights?.teamLength ?? 10,
        weightedScore: breakdown.weighted?.teamLengthScore ?? 0,
        averageWeighted: averageWeighted.teamLengthScore ?? 0,
      },
      {
        name: "Team Territory",
        value: breakdown.teamTerritory ?? 0,
        weight: breakdown.weights?.teamTerritory ?? 1,
        weightedScore: breakdown.weighted?.teamTerritoryScore ?? 0,
        averageWeighted: averageWeighted.teamTerritoryScore ?? 0,
      },
      {
        name: "Team Controlled Food",
        value: breakdown.teamControlledFood ?? breakdown.teamFoodCount ?? 0,
        weight: breakdown.weights?.teamControlledFood ?? 10,
        weightedScore: breakdown.weighted?.teamControlledFoodScore ?? 0,
        averageWeighted: averageWeighted.teamControlledFoodScore ?? 0,
      },
      {
        name: "Food Distance",
        value: breakdown.foodDistance ?? "N/A",
        weight: 0,
        weightedScore: 0,
        averageWeighted: 0,
      },
      {
        name: "Food Proximity",
        value: breakdown.foodProximity ?? breakdown.foodDistanceInverse ?? 0,
        weight: breakdown.weights?.foodProximity ?? 50,
        weightedScore: breakdown.weighted?.foodProximityScore ?? 0,
        averageWeighted: averageWeighted.foodProximityScore ?? 0,
      },
      {
        name: "Food Eaten",
        value: breakdown.foodEaten ?? 0,
        weight: breakdown.weights?.foodEaten ?? 200,
        weightedScore: breakdown.weighted?.foodEatenScore ?? 0,
        averageWeighted: averageWeighted.foodEatenScore ?? 0,
      },
      {
        name: "Enemy Territory",
        value: breakdown.enemyTerritory ?? 0,
        weight: breakdown.weights?.enemyTerritory ?? 0,
        weightedScore: breakdown.weighted?.enemyTerritoryScore ?? 0,
        averageWeighted: averageWeighted.enemyTerritoryScore ?? 0,
      },
      {
        name: "Enemy Length",
        value: breakdown.enemyLength ?? 0,
        weight: breakdown.weights?.enemyLength ?? 0,
        weightedScore: breakdown.weighted?.enemyLengthScore ?? 0,
        averageWeighted: averageWeighted.enemyLengthScore ?? 0,
      },
      {
        name: "Edge Penalty",
        value: breakdown.edgePenalty ?? breakdown.stats?.edgePenalty ?? 0,
        weight: breakdown.weights?.edgePenalty ?? 50,
        weightedScore: breakdown.weighted?.edgePenaltyScore ?? 0,
        averageWeighted: averageWeighted.edgePenaltyScore ?? 0,
      },
      {
        name: "Self Space",
        value:
          breakdown.selfSpace ?? breakdown.stats?.selfSpace ?? "—",
        weight: breakdown.weights?.selfSpace ?? 120,
        weightedScore: breakdown.weighted?.selfSpaceScore ?? "—",
        averageWeighted: averageWeighted.selfSpaceScore ?? "—",
      },
      {
        name: "Allies Space",
        value:
          breakdown.alliesEnoughSpace ??
          breakdown.stats?.alliesEnoughSpace ??
          0,
        weight: breakdown.weights?.alliesEnoughSpace ?? 15,
        weightedScore: breakdown.weighted?.alliesEnoughSpaceScore ?? 0,
        averageWeighted: averageWeighted.alliesEnoughSpaceScore ?? 0,
      },
      {
        name: "Opponents Space",
        value:
          breakdown.opponentsEnoughSpace ??
          breakdown.stats?.opponentsEnoughSpace ??
          0,
        weight: breakdown.weights?.opponentsEnoughSpace ?? -15,
        weightedScore: breakdown.weighted?.opponentsEnoughSpaceScore ?? 0,
        averageWeighted: averageWeighted.opponentsEnoughSpaceScore ?? 0,
      },
      {
        name: "Kills",
        value: breakdown.kills ?? 0,
        weight: breakdown.weights?.kills ?? 0,
        weightedScore: breakdown.weighted?.killsScore ?? 0,
        averageWeighted: averageWeighted.killsScore ?? 0,
      },
      {
        name: "Deaths",
        value: breakdown.deaths ?? 0,
        weight: breakdown.weights?.deaths ?? 0,
        weightedScore: breakdown.weighted?.deathsScore ?? 0,
        averageWeighted: averageWeighted.deathsScore ?? 0,
      },
      {
        name: "Enemy H2H Risk",
        value: breakdown.enemyH2HRisk ?? 0,
        weight: breakdown.weights?.enemyH2HRisk ?? 0,
        weightedScore: breakdown.weighted?.enemyH2HRiskScore ?? 0,
        averageWeighted: averageWeighted.enemyH2HRiskScore ?? 0,
      },
      {
        name: "Ally H2H Risk",
        value: breakdown.allyH2HRisk ?? 0,
        weight: breakdown.weights?.allyH2HRisk ?? 0,
        weightedScore: breakdown.weighted?.allyH2HRiskScore ?? 0,
        averageWeighted: averageWeighted.allyH2HRiskScore ?? 0,
      },
      {
        name: "Enemy Piece Threat",
        value: breakdown.enemyPieceThreat ?? 0,
        weight: breakdown.weights?.enemyPieceThreat ?? 0,
        weightedScore: breakdown.weighted?.enemyPieceThreatScore ?? 0,
        averageWeighted: averageWeighted.enemyPieceThreatScore ?? 0,
      },
      {
        name: "Ally Piece Threat",
        value: breakdown.allyPieceThreat ?? 0,
        weight: breakdown.weights?.allyPieceThreat ?? 0,
        weightedScore: breakdown.weighted?.allyPieceThreatScore ?? 0,
        averageWeighted: averageWeighted.allyPieceThreatScore ?? 0,
      },
      {
        name: "Goto progress (green)",
        value: breakdown.gotoProgress ?? 0,
        weight: breakdown.weights?.gotoProgress ?? 0,
        weightedScore: breakdown.weighted?.gotoProgressScore ?? 0,
        averageWeighted: averageWeighted.gotoProgressScore ?? 0,
      },
      {
        name: "Near progress (blue)",
        value: breakdown.nearProgress ?? 0,
        weight: breakdown.weights?.nearProgress ?? 0,
        weightedScore: breakdown.weighted?.nearProgressScore ?? 0,
        averageWeighted: averageWeighted.nearProgressScore ?? 0,
      },
      {
        name: "Aggression (hunt weaker)",
        value: breakdown.aggression ?? "—",
        weight: breakdown.weights?.aggression ?? 0,
        weightedScore: breakdown.weighted?.aggressionScore ?? 0,
        averageWeighted: averageWeighted.aggressionScore ?? 0,
      },
      {
        name: "Trapped (fatal pocket)",
        value: breakdown.trapped ?? "—",
        weight: breakdown.weights?.trapped ?? 0,
        weightedScore: breakdown.weighted?.trappedScore ?? 0,
        averageWeighted: averageWeighted.trappedScore ?? 0,
      },
      ...(breakdown.fertileTerritory !== undefined && !breakdown.myTerritory
        ? [
            {
              name: "Fertile Territory",
              value: breakdown.fertileTerritory ?? 0,
              weight: breakdown.weights?.fertileTerritory ?? 1,
              weightedScore: breakdown.weighted?.fertileScore ?? 0,
              averageWeighted: averageWeighted.fertileScore ?? 0,
            },
          ]
        : []),
    ];

    // Coerce defensively: these values come from stored decision-log rows as
    // well as live evaluations, and a single non-numeric field must not
    // abort the table build partway. The table is diagnostics — it must
    // degrade to a dash rather than take the rest of the UI update down with it.
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    metricsConfig.forEach((metric) => {
      metric.value = num(metric.value);
      metric.weight = num(metric.weight);
      metric.weightedScore = num(metric.weightedScore);
      metric.averageWeighted = num(metric.averageWeighted);
      metric.marginalImpact = metric.weightedScore - metric.averageWeighted;
    });

    metricsConfig.sort(
      (a, b) => Math.abs(b.marginalImpact) - Math.abs(a.marginalImpact),
    );

    let rows = metricsConfig.map((metric) => {
      const weightDisplay = metric.weight !== 0 ? metric.weight : "";
      const scoreDisplay =
        metric.weight !== 0 ? metric.weightedScore.toFixed(2) : "";
      const impactDisplay =
        metric.weight !== 0
          ? (metric.marginalImpact >= 0 ? "+" : "") +
            metric.marginalImpact.toFixed(2)
          : "";
      let impactColor = "#888";
      if (metric.marginalImpact > 0) impactColor = "#4CAF50";
      else if (metric.marginalImpact < 0) impactColor = "#f44336";
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

    const totalMarginalImpact =
      move.score -
      candidateMoves.reduce((sum, m) => sum + (m.score ?? 0), 0) /
        (candidateMoves.length || 1);
    rows.push(`
      <tr class="total-row">
        <td>Total Score</td>
        <td colspan="2">States: ${move.numStates || 1}</td>
        <td>${(move.score ?? 0).toFixed(2)}</td>
        <td style="color: ${totalMarginalImpact >= 0 ? "#4CAF50" : "#f44336"}; font-weight: 600;">
          ${totalMarginalImpact >= 0 ? "+" : ""}${totalMarginalImpact.toFixed(2)}
        </td>
      </tr>
    `);

    tbody.innerHTML = rows.join("");
  }

  function renderMinimap(canvas, gameState, ourSnakeId) {
    const ctx = canvas.getContext("2d");
    if (!gameState || !gameState.board) return;
    const board = gameState.board;
    const cellSize = Math.min(
      canvas.width / board.width,
      canvas.height / board.height,
    );
    const boardW = board.width * cellSize;
    const boardH = board.height * cellSize;

    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#000000";
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

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, boardW - 2, boardH - 2);

    if (board.hazards && board.hazards.length > 0) {
      board.hazards.forEach((hazard) => {
        const x = hazard.x * cellSize;
        const y = (board.height - 1 - hazard.y) * cellSize;
        ctx.save();
        ctx.fillStyle = "#dc1e1e";
        ctx.fillRect(x, y, cellSize, cellSize);
        ctx.restore();
      });
    }

    if (board.fertileTiles && board.fertileTiles.length > 0) {
      board.fertileTiles.forEach((tile) => {
        const x = tile.x * cellSize;
        const y = (board.height - 1 - tile.y) * cellSize;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellSize, cellSize);
        ctx.clip();
        ctx.strokeStyle = "rgba(240, 198, 70, 0.85)";
        ctx.lineWidth = Math.max(1.5, cellSize / 7);
        const stripeSpacing = Math.max(4, cellSize / 3.5);
        for (let offset = 0; offset <= cellSize * 2; offset += stripeSpacing) {
          ctx.beginPath();
          ctx.moveTo(x + offset, y);
          ctx.lineTo(x + offset - cellSize, y + cellSize);
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    board.food.forEach((food) => {
      const x = food.x * cellSize;
      const y = (board.height - 1 - food.y) * cellSize;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellSize, cellSize);
      ctx.clip();
      const emojiSize = Math.max(cellSize * 0.7, 6);
      ctx.font = `${emojiSize}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("\u{1F383}", x + cellSize / 2, y + cellSize / 2);
      ctx.restore();
    });

    if (
      board.invulnerabilityPotions &&
      board.invulnerabilityPotions.length > 0
    ) {
      board.invulnerabilityPotions.forEach((potion) => {
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
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("\u{1F9EA}", x + cellSize / 2, y + cellSize / 2);
        }
        ctx.restore();
      });
    }

    const controlledIds = Array.isArray(ourSnakeId)
      ? new Set(ourSnakeId)
      : new Set(ourSnakeId ? [ourSnakeId] : []);

    board.snakes.forEach((snake) => {
      renderSnakeUnified(ctx, snake, board.height, cellSize, {
        isControlled: controlledIds.has(snake.id),
      });
    });
  }

  return {
    hexToRgba,
    getMoveQuality,
    getScoreColor,
    processMoveEvaluations,
    moveDestinationCell,
    renderBoard,
    createBoardOverlay,
    renderSnakeInfo,
    renderMoveButtons,
    updateStatsTable,
    renderMinimap,
    renderTerritoryBoundaries,
    renderSnakeUnified,
    getTeamKey,
    getDisappearedSnakes,
    drawDeathMarker,
    drawUnknownDeathMarker,
    getClickedCell,
    getNameTagAt,
    drawUnitIcon,
    unitIconSVG,
    findSnakeAtCell,
    findTerritoryOwnerAtCell,
    _moveClickHandler: null,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = BoardRenderer;
}
