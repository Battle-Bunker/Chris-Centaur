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

  // ── Canvas resolution ─────────────────────────────────────────────────────
  // Every canvas here is DRAWN in CSS pixels and BACKED by a bitmap at the
  // display's own resolution: the backing store is cssSize x scale and the
  // context carries a matching transform, which is what lets every draw call
  // below keep speaking CSS pixels while landing on real device pixels.
  //
  // The scale is the device pixel ratio itself, floored at 1 and capped at 3.
  // It is deliberately NOT raised to 2 on a 1x display: there the browser has
  // to resample a 2x bitmap back down onto the CSS grid, which softens exactly
  // what this board is made of — hairline grid strokes and small tag text — to
  // buy smoother diagonals the board has almost none of. The cap stops a 4x
  // display from paying 16x the fill rate for a difference no eye collects.
  //
  // The page owns each canvas's CSS box; the renderer owns only its backing
  // store. Nothing here writes to canvas.style, so a canvas laid out by CSS
  // keeps the box it was given, and a canvas that would otherwise take its size
  // from its width/height attributes says so at its own call site (see
  // play-game.html's board size and board-test.html's fixtures).
  const MAX_RENDER_SCALE = 3;

  function renderScale() {
    const dpr =
      typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;
    return Math.min(Math.max(dpr, 1), MAX_RENDER_SCALE);
  }

  // The scale each canvas/context was last prepared at, so CSS size and stroke
  // alignment can be recovered without re-reading the display mid-frame.
  const _canvasScale = new WeakMap();
  const _contextScale = new WeakMap();

  function contextScale(ctx) {
    const scale = _contextScale.get(ctx);
    return typeof scale === "number" && scale > 0 ? scale : 1;
  }

  // A canvas's drawing size in CSS pixels — the coordinate system every draw
  // call in this file speaks. The laid-out box is the truth; a canvas with no
  // layout (detached fixtures, tests) falls back to its backing store divided
  // by the scale it was prepared at.
  function canvasCssSize(canvas) {
    if (!canvas) return { width: 0, height: 0 };
    const boxWidth = canvas.clientWidth || 0;
    const boxHeight = canvas.clientHeight || 0;
    if (boxWidth > 0 && boxHeight > 0) {
      return { width: boxWidth, height: boxHeight };
    }
    const scale = _canvasScale.get(canvas) || 1;
    return { width: canvas.width / scale, height: canvas.height / scale };
  }

  // Size a canvas's backing store for the display and hand back a context whose
  // units are CSS pixels. Resizing a canvas clears it, so the buffer is only
  // written when it actually changes; the transform is (re)applied every time,
  // since anything that does touch the buffer resets it.
  function prepareCanvas(canvas, cssWidth, cssHeight) {
    const ctx = canvas.getContext("2d");
    const scale = renderScale();
    const bufferWidth = Math.max(1, Math.round(cssWidth * scale));
    const bufferHeight = Math.max(1, Math.round(cssHeight * scale));
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    _canvasScale.set(canvas, scale);
    _contextScale.set(ctx, scale);
    if (ctx.setTransform) ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return ctx;
  }

  // Device-pixel alignment for the board's thin strokes. Under a scaled context
  // the classic "+0.5 CSS pixel" no longer lands on a device-pixel boundary, so
  // position and width are both resolved in DEVICE pixels and handed back in
  // the CSS units the drawing code speaks: the width rounds to a whole number
  // of device pixels, and the position takes the half-pixel offset only when
  // that count is odd (an even-width stroke sits cleanly on the boundary).
  function crispStroke(ctx, cssPos, cssWidth) {
    const scale = contextScale(ctx);
    const deviceWidth = Math.max(1, Math.round(cssWidth * scale));
    const halfPixel = (deviceWidth % 2) / 2;
    return {
      pos: (Math.round(cssPos * scale) + halfPixel) / scale,
      width: deviceWidth / scale,
    };
  }

  // Fire `onChange` whenever the display's device-pixel ratio changes — browser
  // zoom, or the window moving to a monitor of another density. A media query
  // can only watch ONE ratio, so the listener re-arms itself against the new
  // ratio each time it fires.
  function watchRenderScale(onChange) {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const arm = () => {
      const media = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      );
      const fired = () => {
        if (media.removeEventListener) {
          media.removeEventListener("change", fired);
        } else if (media.removeListener) {
          media.removeListener(fired);
        }
        arm();
        onChange();
      };
      if (media.addEventListener) media.addEventListener("change", fired);
      else if (media.addListener) media.addListener(fired);
    };
    arm();
  }

  // The on-screen size of one board cell in CSS pixels — the single derivation
  // the renderer, the HTML overlays and every hit-test share, so a resized
  // board can never leave one of them on a stale scale.
  function boardCellSize(canvas, board) {
    if (!canvas || !board) return 0;
    const { width, height } = canvasCssSize(canvas);
    return Math.min(width / board.width, height / board.height);
  }

  // A pointer event's position in the canvas's CSS-pixel drawing space. The
  // bounding rect is the BORDER box, so the element's own border is stepped
  // over to land on the content box the renderer actually draws into.
  function pointerToCanvas(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const { width, height } = canvasCssSize(canvas);
    const boxWidth = canvas.clientWidth || rect.width || width;
    const boxHeight = canvas.clientHeight || rect.height || height;
    if (!boxWidth || !boxHeight) return { x: 0, y: 0 };
    const left = rect.left + (canvas.clientLeft || 0);
    const top = rect.top + (canvas.clientTop || 0);
    return {
      x: ((event.clientX - left) * width) / boxWidth,
      y: ((event.clientY - top) * height) / boxHeight,
    };
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

  // ── Unit orientation ─────────────────────────────────────────────────────
  // Every unit carries its WIRE orientation on Snake.orientation
  // (Turn.orientation, verbatim: full-board convention, dy grows DOWNWARD),
  // which matches canvas rows exactly, so dx/dy apply to canvas offsets with
  // no flip. Icons always draw UPRIGHT; a PIECE's facing shows as an eye on
  // the faced cell edge (drawOrientationEye), live and replay. Snakes carry
  // their facing in the head/neck geometry and draw no eye.
  // The eye takes the orientation's UNIT vector, so an axis step (±1, 0),
  // a diagonal (±1, ±1) and a knight L-offset (±1, ±2) all resolve to their
  // true screen angle rather than to one of four quarter turns.
  function orientationUnitVector(orientation) {
    if (!orientation) return null;
    const dx = orientation.dx || 0;
    const dy = orientation.dy || 0;
    const len = Math.hypot(dx, dy);
    if (!len) return null;
    return { ux: dx / len, uy: dy / len };
  }

  // A unit is a chess PIECE when it carries a unitType other than "snake".
  // Everything else — a plain snake, and every letter/emoji-era historical
  // unit that predates unitType — is a snake. THE one definition of the
  // snake/piece split: every caller that genuinely needs it (here and in
  // play-game.html) reads this, so no surface can invent its own answer.
  function isPieceUnit(unit) {
    return !!(unit && unit.unitType && unit.unitType !== "snake");
  }

  // Does this unit's head cell carry the orientation eye? A snake's facing is
  // already legible in the geometry of its head and neck, so the eye only adds
  // noise there; a piece occupies a single cell and has no such cue, so the
  // mark is the only thing that says which way it points. An orientation-less
  // unit (ghost, corpse) draws none either way.
  function unitDrawsOrientationEye(unit) {
    return isPieceUnit(unit) && !!orientationUnitVector(unit.orientation);
  }

  // Orientation eye: a stroke-only mark in a single translucent sky blue —
  // no fill, so it never competes with the white/black icon language beneath
  // it. Two strokes: a long FLAT brow arc spanning slightly beyond the cell,
  // bowing gently out of the faced edge, and a small lens (the pupil) nested
  // against the arc's back. The lens's anchor sits between the unit icon's
  // edge and the cell boundary along the facing ray, so the mark reads as an
  // eye surfacing at the faced edge. Drawn OUTSIDE the head-cell clip: the
  // brow's tips and apex deliberately overhang the cell by a few percent.
  // Callers skip it for ghosts/corpses (an orientation-less cell draws none).
  const EYE_STROKE = "rgba(56, 174, 255, 0.8)";
  function drawOrientationEye(ctx, orientation, hx, hy, cellSize) {
    const u = orientationUnitVector(orientation);
    if (!u) return;
    const { ux, uy } = u;
    // Tangent to the faced edge: the orientation vector turned a quarter turn.
    const tx = -uy;
    const ty = ux;
    const cx = hx + cellSize / 2;
    const cy = hy + cellSize / 2;
    // Cell centre -> the point where the facing ray LEAVES the cell: half a
    // cell for an axis facing, the corner itself for a 45 degree diagonal, so
    // a diagonal eye surfaces at the corner it faces.
    const reach = cellSize / 2 / Math.max(Math.abs(ux), Math.abs(uy));
    const at = (d, s) => [cx + ux * d + tx * s, cy + uy * d + ty * s];

    ctx.save();
    ctx.strokeStyle = EYE_STROKE;
    ctx.lineWidth = Math.max(1.6, cellSize * 0.055);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Depths along the facing ray are measured from the point where the ray
    // leaves the cell (`reach`) in CELL units, not in fractions of `reach`:
    // that keeps the brow's overhang and the lens's thickness identical for
    // axis, diagonal and knight facings, where `reach` itself differs by up
    // to 1.4x. A quadratic's apex sits halfway between its control point and
    // the chord, so each control is placed at twice the wanted bulge.
    // Brow: a long flat arc, tips a whisker past the cell's sides, apex
    // clearing the faced edge by ~24% of a cell.
    const browEnd = reach * 0.6;
    const browApex = reach + cellSize * 0.24;
    const half = cellSize * 0.62;
    const [ax, ay] = at(browEnd, half);
    const [bx, by] = at(browEnd, -half);
    const [qx, qy] = at(2 * browApex - browEnd, 0);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(qx, qy, bx, by);
    ctx.stroke();

    // Lens (the pupil): a slim almond nested against the brow's back, its
    // chord anchored between the icon's edge and the cell boundary, with a
    // clear gap of ~1/5 cell between its front and the brow's apex.
    const lensHalf = cellSize * 0.22;
    const lensMid = reach - cellSize * 0.06;
    const lensDepth = cellSize * 0.1;
    const [s1x, s1y] = at(lensMid, lensHalf);
    const [s2x, s2y] = at(lensMid, -lensHalf);
    const [fx, fy] = at(lensMid + 2 * lensDepth, 0); // front (toward the brow)
    const [kx, ky] = at(lensMid - 2 * lensDepth, 0); // back (toward the icon)
    ctx.beginPath();
    ctx.moveTo(s1x, s1y);
    ctx.quadraticCurveTo(fx, fy, s2x, s2y);
    ctx.quadraticCurveTo(kx, ky, s1x, s1y);
    ctx.stroke();
    ctx.restore();
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
  // ORIENTATION: icons draw UPRIGHT everywhere. Facing is carried by the
  // orientation eye on the cell edge (drawOrientationEye), which reads as a
  // direction at a glance where a rotated 2D icon does not.
  const ICON_COLORS = {
    base: "#ffffff",
    line: "rgba(0, 0, 0, 0.8)",
    accent: "#e53935",
  };
  // An Archimedean spiral sampled into a polyline, running outward from the
  // tail at the centre and finishing at `endAngle`. Round joins and caps make
  // the samples read as one smooth curve. `pitch` is the radius gained per
  // full turn — keeping it wider than the body stroke is what stops adjacent
  // coils from fusing into a plain disc.
  function spiralPath(cx, cy, innerRadius, pitch, turns, endAngle) {
    const sweep = turns * Math.PI * 2;
    const steps = Math.max(8, Math.round(turns * 28));
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = endAngle - sweep * (1 - t);
      const radius = innerRadius + pitch * turns * t;
      points.push(
        `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`,
      );
    }
    return `M${points[0]} L${points.slice(1).join(" L")}`;
  }

  // The snake's body: a coil spiralling out from the tail at its centre to the
  // top, then a neck rising to the head at the upper right.
  const SNAKE_COIL = `${spiralPath(9.4, 14.2, 0.2, 3.8, 1.3, -Math.PI / 2)} C10.6 7.6 11.6 6.6 13.4 6.2`;
  const UNIT_ICONS = {
    pawn: [
      {
        // Plain pawn: a round ball head over a flared body on a wide foot.
        d:
          "M12 2.3 a3.6 3.6 0 1 0 0.001 0 Z " +
          "M10.3 8.6 L9.1 16.2 L5.6 18.3 L5.6 20.8 L18.4 20.8 L18.4 18.3 L14.9 16.2 L13.7 8.6 Z",
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
      // Curled-up snake. The coil is one stroke laid down twice: a wide dark
      // pass that serves as both outline and the seam between adjacent coils,
      // then a narrower light core. Head, eye and forked tongue go on top —
      // they are what carries the read at ~20px, where the coil arms merge.
      {
        d: SNAKE_COIL,
        op: "stroke",
        color: "line",
        w: 5,
      },
      {
        d: SNAKE_COIL,
        op: "stroke",
        color: "base",
        w: 3,
      },
      {
        d: "M19 6.3 L21.2 6.9 M21.2 6.9 L22.5 6.3 M21.2 6.9 L22.3 8",
        op: "stroke",
        color: "accent",
        w: 1.5,
      },
      {
        // Wedge head: broad behind the eye, tapering to a blunt snout, which
        // is the silhouette that says "snake" once the coil is a thumbnail.
        d:
          "M12.2 3.2 C14.6 2.5 17.2 3.4 19 4.9 C19.8 5.5 19.8 6.5 19 7.1 " +
          "C17.2 8.6 14.6 9.5 12.2 8.8 C10.4 8.3 10.4 3.7 12.2 3.2 Z",
        op: "fill",
        color: "base",
        outline: true,
      },
      { d: "M15.2 3.95 a1.05 1.05 0 1 0 0.001 0 Z", op: "fill", color: "line" },
    ],
  };

  // Draw a unit icon centred at (cx, cy) with the given pixel size on a canvas.
  // Filled layers stroke their dark outline FIRST so the outline sits behind
  // the fill (bold mark, thin dark rim).
  function drawUnitIcon(ctx, unitKey, cx, cy, size) {
    const icon = UNIT_ICONS[unitKey] || UNIT_ICONS.snake;
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
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
  function unitIconSVG(unitKey, sizePx) {
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
    return `<svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true" style="display:block;">${parts.join("")}</svg>`;
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

  // The quarter-turn glyph for turning `from` → `to`. Both orientations use the
  // wire convention (y grows downward), which matches canvas rows: a positive
  // cross product is a clockwise (screen) quarter turn. An unknown `from`
  // reads as clockwise rather than drawing nothing.
  function rotationGlyph(from, to) {
    if (from && to && (from.dx || from.dy) && from.dx * to.dy - from.dy * to.dx < 0) {
      return "↺"; // ↺ counter-clockwise
    }
    return "↻"; // ↻ clockwise
  }

  // THE rotation indicator: one turn spent turning, drawn as ↻/↺ centred on
  // (x, y) at `size` px. One drawing for both places a rotation is shown — the
  // pawn's staged-rotation badge on its own cell, and each PLANNED rotation
  // along a goto route — so the two always speak the same visual language.
  function drawRotationBadge(ctx, from, to, x, y, size, opts) {
    const glyph = rotationGlyph(from, to);
    ctx.save();
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = (opts && opts.alpha) != null ? opts.alpha : 1;
    ctx.lineWidth = Math.max(size * 0.18, 1.5);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(glyph, x, y);
    ctx.fillStyle = (opts && opts.color) || "#80d8ff";
    ctx.fillText(glyph, x, y);
    ctx.restore();
  }

  // Head glyph: a PIECE's single cell draws its unit ICON — the custom-drawn
  // piece marks (see UNIT_ICONS) — upright, plus the orientation eye on the
  // faced cell edge; pawns additionally carry the staged-rotation badge. The
  // cell carries no letter: a piece has no body to write on, so its tag's
  // letter square is the letter's home, anchored on the cell diagonally
  // adjacent to this one (renderUnitTags). Snakes take the other path — their
  // head cell carries the letter itself, at the head of the information their
  // body spells out (unitBodyInfoPlan). The eye draws over the icon and under
  // the tags, so facing is never buried and never buries.
  function drawHeadGlyph(ctx, snake, hx, hy, cellSize, glyphOpts) {
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
    drawUnitIcon(ctx, snake.unitType, cx, cy, Math.max(cellSize * 0.78, 12));
    // Staged-rotation badge (pawns): the shared ↻/↺ mark in the top-left
    // corner (the mirror of the bottom-right weight badge) while a side-square
    // rotation is staged — the piece spends the turn turning, so no
    // destination arrow is drawn.
    const stagedRotation = glyphOpts && glyphOpts.stagedRotation;
    if (stagedRotation) {
      drawRotationBadge(
        ctx, snake.orientation, stagedRotation,
        hx + cellSize * 0.2, hy + cellSize * 0.3,
        Math.max(cellSize * 0.34, 8),
      );
    }
    ctx.restore();
    // Outside the cell clip: the eye deliberately overhangs the cell.
    if (unitDrawsOrientationEye(snake)) {
      drawOrientationEye(ctx, snake.orientation, hx, hy, cellSize);
    }
  }

  // Weight icon: a silver ANVIL, drawn from one path so the on-board tags and
  // the units table show the same mark. No anvil EMOJI renders reliably (the
  // codepoint is young and most platforms fall back to a coloured stand-in or
  // tofu), and weight wants a heavy, monochrome silhouette rather than a
  // colour picture — hence the hand-drawn path. `w`/`h` are its box, so both
  // surfaces can scale it to a text line without guessing its aspect.
  const ANVIL_ICON = {
    w: 24,
    h: 20,
    // Pointed horn on the left, long flat face across the top overhanging a
    // waisted body, splayed foot: the silhouette that says "anvil" and nothing
    // else at a dozen pixels.
    d:
      "M0.5 7 L7 3 L23 3 L23 7 L16.5 8.6 L15 13.4 L20 17 L20 19.5 " +
      "L4 19.5 L4 17 L9 13.4 L7.5 8.6 L3 7.8 Z",
    // Where the path's INK sits inside that box (see STAT_MARK): the anvil
    // leaves air above and below, and a symbol stacked over a number only
    // reads as its equal if it is sized and centred by the ink the eye sees.
    ink: { x: 0.5, y: 3, w: 22.5, h: 16.5 },
  };
  const ANVIL_COLORS = {
    fill: "#c2c7cd", // silver
    line: "rgba(20, 24, 30, 0.75)", // the rim that keeps it legible on white
  };

  // The anvil on a canvas, left-aligned at `x` and vertically centred on
  // `midY` at the given line height (the tag's stat row).
  function drawAnvilIcon(ctx, x, midY, height) {
    const scale = height / ANVIL_ICON.h;
    ctx.save();
    ctx.translate(x, midY - height / 2);
    ctx.scale(scale, scale);
    const p = new Path2D(ANVIL_ICON.d);
    ctx.lineJoin = "round";
    ctx.strokeStyle = ANVIL_COLORS.line;
    ctx.lineWidth = 1.8;
    ctx.stroke(p);
    ctx.fillStyle = ANVIL_COLORS.fill;
    ctx.fill(p);
    ctx.restore();
  }

  // The same anvil as inline SVG, for the units table's weight column.
  function anvilIconSVG(heightPx) {
    const w = (heightPx * ANVIL_ICON.w) / ANVIL_ICON.h;
    return (
      `<svg viewBox="0 0 ${ANVIL_ICON.w} ${ANVIL_ICON.h}" width="${w.toFixed(1)}" height="${heightPx}" ` +
      `aria-hidden="true" style="vertical-align:-2px;">` +
      `<path d="${ANVIL_ICON.d}" fill="${ANVIL_COLORS.fill}" stroke="${ANVIL_COLORS.line}" ` +
      `stroke-width="1.8" stroke-linejoin="round"/></svg>`
    );
  }

  // Hazard mark: a RED warning triangle with an exclamation, drawn from one
  // path so the on-board tags and the units table show the same mark. The
  // warning EMOJI it replaces arrives in each platform's own colour (amber on
  // most, and a picture rather than a symbol), which reads as decoration next
  // to the board's red hazard lattice instead of as the same danger. One path,
  // one red, every surface. `w`/`h` are its box, so both surfaces can scale it
  // to a text line without guessing its aspect.
  const HAZARD_ICON = {
    w: 24,
    h: 21,
    // ONE path: the rounded triangle, then the exclamation's bar and dot as
    // further sub-paths wound the SAME way as the triangle. Filled nonzero the
    // path is a solid triangle (the white backing); filled even-odd the bar
    // and dot become holes, so the exclamation is the backing showing through
    // rather than a second shape that could drift out of register. The bar and
    // dot are cut FAT — at a dozen pixels a fine exclamation closes up and the
    // mark reads as a plain red triangle.
    d:
      "M13.34 3.62 L21.76 17.58 Q23.1 19.8 20.5 19.8 L3.5 19.8 " +
      "Q0.9 19.8 2.24 17.58 L10.66 3.62 Q12 1.4 13.34 3.62 Z " +
      "M9.8 6.6 L14.2 6.6 L13.7 13.4 L10.3 13.4 Z " +
      "M10.15 15.2 L13.85 15.2 L13.85 18.6 L10.15 18.6 Z",
    // The triangle's own extent inside that box, apex to base (see ANVIL_ICON).
    ink: { x: 0.9, y: 1.4, w: 22.2, h: 18.4 },
  };
  const HAZARD_COLORS = {
    fill: "#d81b1b", // the hazard lattice's red, at full strength
    inner: "#ffffff", // the exclamation, backing the even-odd holes
  };

  // The hazard mark on a canvas, left-aligned at `x` and vertically centred on
  // `midY` at the given line height (the tag's stat row).
  function drawHazardIcon(ctx, x, midY, height) {
    const scale = height / HAZARD_ICON.h;
    ctx.save();
    ctx.translate(x, midY - height / 2);
    ctx.scale(scale, scale);
    const p = new Path2D(HAZARD_ICON.d);
    ctx.fillStyle = HAZARD_COLORS.inner;
    ctx.fill(p, "nonzero");
    ctx.fillStyle = HAZARD_COLORS.fill;
    ctx.fill(p, "evenodd");
    ctx.restore();
  }

  // The same hazard mark as inline SVG, for the units table's invulnerability
  // column. Two elements, one `d`: the nonzero backing under the even-odd red.
  function hazardIconSVG(heightPx) {
    const w = (heightPx * HAZARD_ICON.w) / HAZARD_ICON.h;
    return (
      `<svg viewBox="0 0 ${HAZARD_ICON.w} ${HAZARD_ICON.h}" width="${w.toFixed(1)}" height="${heightPx}" ` +
      `aria-hidden="true" style="vertical-align:-2px;">` +
      `<path d="${HAZARD_ICON.d}" fill="${HAZARD_COLORS.inner}" fill-rule="nonzero"/>` +
      `<path d="${HAZARD_ICON.d}" fill="${HAZARD_COLORS.fill}" fill-rule="evenodd"/></svg>`
    );
  }

  // Stat glyphs shared by the on-board unit tags and the units table, so one
  // stat always reads as one symbol wherever it appears. Weight (the anvil)
  // and extra-vulnerability (the hazard triangle) are drawn paths rather than
  // characters, so neither carries an entry here.
  const STAT_ICON = {
    health: "\u2665", // heart, tinted by healthBarColor
    invulnerable: "\u{1F6E1}\uFE0F", // shield (positive level)
  };

  // The drawn stat marks, keyed by the name a stat carries in `stat.mark`.
  // Both the layout pass and the draw pass look a mark up here, so a mark can
  // never be measured from one path and painted from another.
  const STAT_MARK = {
    anvil: { icon: ANVIL_ICON, draw: drawAnvilIcon },
    hazard: { icon: HAZARD_ICON, draw: drawHazardIcon },
  };

  // The INK of the glyph stat symbols, per unit of font size: how tall it
  // stands, and how far its centre sits above the alphabetic baseline. A glyph
  // fills its em box neither fully nor symmetrically — a heart is barely more
  // than half its font size tall and rides high, the shield emoji overflows
  // the em in both directions — so a symbol stacked over a number can only be
  // sized and centred against numbers if it is measured by its ink. Taken from
  // Chromium's canvas text metrics (actualBoundingBox, bold sans).
  const STAT_GLYPH_INK = {
    [STAT_ICON.health]: { h: 0.58, mid: 0.27 },
    [STAT_ICON.invulnerable]: { h: 1.18, mid: 0.34 },
  };
  // A glyph nobody has measured: assume it behaves like a capital letter. The
  // fit still measures its WIDTH for real, so the worst case is a symbol drawn
  // a little small rather than one that overruns its plate.
  const STAT_GLYPH_INK_DEFAULT = { h: 0.7, mid: 0.35 };
  // The ink height of a bold sans DIGIT, per unit of font size, from the same
  // metrics: digits sit on the baseline and stand 0.70 of their size tall, so
  // a number's row height and its baseline both follow from its font size.
  const DIGIT_INK_HEIGHT = 0.7;

  // Health-bar track: the dark under-layer the units-table health bar draws
  // its fill on. The on-cell bar uses HEALTH_BAR_CELL_TRACK instead.
  const HEALTH_BAR_TRACK = "rgba(0, 0, 0, 0.4)";
  // The on-cell bar's track is SOLID BLACK: it sits on the unit's own body
  // colour, and only an opaque track keeps the empty part of the bar reading
  // as "missing health" rather than as a tint of the team colour.
  const HEALTH_BAR_CELL_TRACK = "#000000";

  // The invulnerability mark for a level, as a stat descriptor: the shield
  // GLYPH when protected, the drawn red hazard MARK when the level is negative
  // (extra-vulnerable). Both surfaces ask here, so one level can never wear
  // two different marks.
  function invulnerabilityMark(level) {
    return level > 0 ? { icon: STAT_ICON.invulnerable } : { mark: "hazard" };
  }

  // Turns of invulnerability left, INCLUSIVE of the turn being displayed,
  // derived from the absolute expiry turn the game server supplies. Returns
  // null when the wire carries no expiry (older logs), when the caller has no
  // turn to measure against, or when the level has already lapsed at that
  // turn — every surface that shows a countdown asks here, so the board and
  // the units table can never disagree about how long a buff has to run.
  function invulnerabilityTurnsRemaining(snake, currentTurn) {
    const expiry = snake && snake.invulnerabilityExpiryTurn;
    if (typeof expiry !== "number" || typeof currentTurn !== "number") {
      return null;
    }
    const remaining = expiry - currentTurn + 1;
    return remaining >= 1 ? remaining : null;
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
  // piece cell): bottom-anchored, ~90% of the cell wide, ~15% tall, a BLACK
  // track under a red/orange/green fill. Callers skip ghost/dead snakes — a
  // corpse has no health to read.
  function drawHealthBar(ctx, snake, hx, hy, cellSize) {
    if (typeof snake.health !== "number") return; // pre-health historical rows
    const frac = healthFraction(snake);
    const barW = cellSize * 0.9;
    const barH = Math.max(2, cellSize * 0.15);
    const inset = Math.max(1, cellSize * 0.03);
    const bx = hx + (cellSize - barW) / 2;
    const by = hy + cellSize - barH - inset;
    ctx.save();
    ctx.fillStyle = HEALTH_BAR_CELL_TRACK;
    ctx.fillRect(bx, by, barW, barH);
    if (frac > 0) {
      ctx.fillStyle = healthBarColor(frac);
      ctx.fillRect(bx, by, barW * frac, barH);
    }
    ctx.restore();
  }

  // Hazard cell: a red lattice — a faint wash crossed by GRID-ALIGNED bars,
  // horizontal and vertical — rather than a solid red block. The bars carry
  // the "danger" read while the gaps between them leave whatever shares the
  // cell visible: the black grid lines, a unit standing in the hazard, a
  // candidate ring. Running the bars square to the board rather than on the
  // diagonals keeps them from reading as the diagonal hatch the fertile tiles
  // already own. The clip is inset by a pixel on every side so the lattice
  // never paints over the cell's own grid lines.
  function drawHazardCell(ctx, x, y, cellSize) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, cellSize - 2, cellSize - 2);
    ctx.clip();
    ctx.fillStyle = "rgba(220, 30, 30, 0.18)";
    ctx.fillRect(x, y, cellSize, cellSize);
    ctx.strokeStyle = "rgba(200, 12, 12, 0.9)";
    ctx.lineWidth = Math.max(1, cellSize / 11);
    const spacing = Math.max(4, cellSize / 3);
    // Half a spacing in from the edges, so the pattern is centred in the cell
    // and no bar lands exactly on a grid line the clip is protecting.
    for (let offset = spacing / 2; offset < cellSize; offset += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, y + offset);
      ctx.lineTo(x + cellSize, y + offset);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset, y + cellSize);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── A snake's body as information real estate ────────────────────────────
  // A snake is several cells long, and every cell behind its head is canvas
  // the unit's own numbers can live on — which is where they belong, because
  // a number ON the unit needs no line traced back to it. Walking head → tail,
  // each DISTINCT body cell carries exactly one item:
  //   head        the unit's LETTER, on the same plate every stat behind it
  //               uses, filled with the owning player's colour (its own body
  //               colour when nobody holds it)
  //   neck        weight, under the silver anvil
  //   2nd cell    health, under the heart tinted by the shared thresholds
  //   3rd cell    the TURNS of invulnerability still to run, under the
  //               shield / hazard mark — only while a level is running
  //   tail        how many body parts are STACKED on the tail cell — only when
  //               more than one is
  // Every stat is SYMBOL OVER NUMBER, two rows on one square plate: the symbol
  // is what names the number, so the two arrive together or not at all.
  // The tail's stack count OUTRANKS the flow items: it is the one number
  // nothing else on the board says, so its cell is reserved before the rest
  // are dealt out. Anything that finds no cell — or no cell that can hold both
  // its rows — is dropped, and a dropped item is precisely what makes this
  // unit's TAG worth drawing (renderUnitTags asks this plan, and nothing else).

  // The smallest text a body item may shrink to. Below this a number stops
  // being read and starts being texture, so the item is dropped instead and
  // the tag carries it.
  const BODY_ITEM_MIN_FONT = 9;
  // The smallest a stat's SYMBOL may be drawn, measured across its ink. Below
  // this an anvil, a heart and a shield all collapse into the same small dark
  // blob, and a symbol that cannot be told apart names nothing — so the item
  // is dropped whole rather than drawn as a number nobody can label.
  const BODY_ITEM_MIN_SYMBOL = 6;
  // The share of a plate's inner column the SYMBOL is guaranteed before the
  // number may take any of it, and the air between the two rows as a share of
  // that column.
  const BODY_STACK_SYMBOL = 0.44;
  const BODY_STACK_GAP = 0.07;
  // The plaque a stat item is drawn on: near-white, so a tinted heart, a
  // silver anvil and a dark number keep the same contrast on EVERY team
  // colour and over every terrain a body can lie on.
  const BODY_ITEM_PLAQUE = "rgba(255, 255, 255, 0.94)";
  const BODY_ITEM_TEXT = "#14181e";

  // Every item — the head's letter and every stat behind it — is drawn on ONE
  // square of the same size, so a body reads as a run of identical plates
  // rather than as pills each taking whatever width its own number happens to
  // want. The side is a fraction of the body's own THICKNESS, not the cell's,
  // which is what keeps the unit's colour showing all the way round the plate
  // at every cell size — and what keeps the head's plate clear of the health
  // BAR along that cell's bottom edge (drawHealthBar).
  const BODY_PLATE_SIDE = 0.86;
  // How much of the plate its content may spend, in BOTH directions; the rest
  // is the margin that keeps a number, and the symbol stacked over it, off the
  // plate's rounded corners.
  const BODY_PLATE_INNER = 0.9;
  // The corner radius as a fraction of the side — one value, so the letter
  // square and the stat plates round identically.
  const BODY_PLATE_RADIUS = 0.26;

  // The body cells an item can be placed on: the DISTINCT coordinates the
  // body occupies, head → tail. A snake that doubles back over itself — a
  // stacked tail, a coiled body — shows one cell per coordinate on screen, so
  // it carries one item there too. Same walk renderSnakeUnified fills from,
  // so an item can never land on a cell the body did not draw.
  function distinctBodyCells(body) {
    const seen = new Set();
    const cells = [];
    for (const seg of body) {
      const key = `${seg.x},${seg.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(seg);
    }
    return cells;
  }

  // How many body parts sit stacked on the tail cell — the trailing run of
  // segments sharing the last one's coordinate, which is what a snake carries
  // while it is still growing into the length it has eaten.
  function tailStackCount(body) {
    if (!body || body.length === 0) return 0;
    const tail = body[body.length - 1];
    let n = 0;
    for (let i = body.length - 1; i >= 0; i--) {
      if (body[i].x !== tail.x || body[i].y !== tail.y) break;
      n++;
    }
    return n;
  }

  // THE box every body item is drawn in: the shared square, centred in its
  // cell. One geometry for the letter and for every stat, so a cell can never
  // be located two ways and no item can quietly claim more room than another.
  function bodyPlateBox(cell, boardHeight, cellSize) {
    const side = (cellSize - getSnakeGap(cellSize) * 2) * BODY_PLATE_SIDE;
    const inset = (cellSize - side) / 2;
    return {
      x: cell.x * cellSize + inset,
      y: (boardHeight - 1 - cell.y) * cellSize + inset,
      w: side,
      h: side,
    };
  }

  // One stat SYMBOL solved to a given ink height: what it measures across, and
  // everything the draw pass needs to land that ink on a point. A drawn mark
  // and a glyph answer here alike — the mark by scaling its path box until the
  // ink inside it stands `inkH` tall, the glyph by choosing the font size
  // whose ink does — so the layout pass and the draw pass can never size or
  // place a symbol two different ways. Leaves the measuring font on `ctx`.
  function statSymbolFit(ctx, item, inkH) {
    const mark = STAT_MARK[item.mark];
    if (mark) {
      const { w, h, ink } = mark.icon;
      const scale = inkH / ink.h;
      return {
        inkH,
        inkW: ink.w * scale,
        // What the mark drawer is given: the height of the whole path box, and
        // where that box's centre lies relative to the ink's (the drawer
        // centres the BOX on the y it is handed, and starts it at the x).
        boxH: h * scale,
        boxDX: -ink.x * scale,
        boxDY: (h / 2 - (ink.y + ink.h / 2)) * scale,
      };
    }
    const glyph = STAT_GLYPH_INK[item.icon] || STAT_GLYPH_INK_DEFAULT;
    const fontSize = inkH / glyph.h;
    ctx.font = `700 ${fontSize}px sans-serif`;
    return {
      inkH,
      inkW: ctx.measureText(item.icon).width,
      font: ctx.font,
      // The baseline to draw on, measured down from the ink's centre.
      baselineDY: glyph.mid * fontSize,
    };
  }

  // Fit a STAT item INSIDE the plate, SYMBOL OVER NUMBER. The plate is a
  // square — as tall as it is wide — so a symbol set BESIDE its number spends
  // the width twice over and the height not at all, which is exactly how an
  // anvil came to be dropped from a plate with room to spare above the number.
  // Stacked, each row gets the plate's full width and its own share of the
  // height, and both are solved against that one inner box.
  // Text width scales exactly with font size, so the size that fits is solved
  // for rather than searched: measure once at the preferred size, then take
  // the smallest of what the width allows, what the preferred size allows, and
  // what leaves the SYMBOL its guaranteed share of the column. The symbol then
  // takes every pixel of column the number did not, capped by the plate's
  // width. `null` means the two cannot both be read here — and then the caller
  // drops the item whole, because a number with no symbol over it names
  // nothing, and the unit's tag says it properly instead.
  function fitBodyStat(ctx, item, box, cellSize) {
    // The text's ceiling is the body's own thickness, not the cell's.
    const bodyH = cellSize - getSnakeGap(cellSize) * 2;
    const pref = Math.min(
      Math.max(BODY_ITEM_MIN_FONT, cellSize * 0.34),
      bodyH * 0.62,
    );
    if (pref < BODY_ITEM_MIN_FONT) return null;
    const innerW = box.w * BODY_PLATE_INNER;
    const innerH = box.h * BODY_PLATE_INNER;
    // The tail's stack count is a bare number by design — the tail's own
    // position is what names it — so it has no second row, and no air to
    // leave for one.
    const hasSymbol = !!(item.mark || item.icon);
    const rowGap = hasSymbol ? innerH * BODY_STACK_GAP : 0;
    const column = innerH - rowGap;
    const reserved = hasSymbol
      ? Math.max(BODY_ITEM_MIN_SYMBOL, column * BODY_STACK_SYMBOL)
      : 0;
    ctx.save();
    try {
      ctx.font = `700 ${pref}px sans-serif`;
      const widthPerPx = ctx.measureText(item.text).width / pref;
      if (!(widthPerPx > 0)) return null;
      const fontSize = Math.min(
        pref,
        innerW / widthPerPx,
        (column - reserved) / DIGIT_INK_HEIGHT,
      );
      if (fontSize < BODY_ITEM_MIN_FONT) return null;
      const textInk = fontSize * DIGIT_INK_HEIGHT;
      const fit = {
        font: `700 ${fontSize}px sans-serif`,
        fontSize,
        text: item.text,
        textInk,
        rowGap,
        symbol: null,
        blockH: textInk,
      };
      if (!hasSymbol) return fit;
      let symbol = statSymbolFit(ctx, item, column - textInk);
      if (symbol.inkW > innerW) {
        symbol = statSymbolFit(ctx, item, (symbol.inkH * innerW) / symbol.inkW);
      }
      if (symbol.inkH < BODY_ITEM_MIN_SYMBOL) return null;
      fit.symbol = symbol;
      fit.blockH = symbol.inkH + rowGap + textInk;
      return fit;
    } finally {
      ctx.restore();
    }
  }

  // Fit the LETTER into the same plate, solved against the same inner width:
  // the letter is the unit's name out loud, so a wide one is made smaller
  // rather than turned away, and only a plate too small to read anything in
  // gives it up to the tag.
  function fitBodyLetter(ctx, item, box) {
    if (box.w < BODY_ITEM_MIN_FONT) return null;
    const pref = box.w * 0.74;
    ctx.save();
    ctx.font = `800 ${pref}px sans-serif`;
    const atPref = ctx.measureText(item.text).width;
    ctx.restore();
    const avail = box.w * BODY_PLATE_INNER;
    const fontSize = atPref > avail ? (pref * avail) / atPref : pref;
    if (fontSize < BODY_ITEM_MIN_FONT) return null;
    return { font: `800 ${fontSize}px sans-serif`, fontSize };
  }

  // THE plate every body item is drawn on: a rounded square of the shared size
  // and radius, optionally rimmed. Both readings — the head's letter square
  // and a stat's plaque — are painted through here, so the two can never round
  // or size differently. The rim is drawn INSIDE the square, so a rimmed plate
  // and a bare one take up exactly the same footprint.
  function drawBodyPlate(ctx, box, fill, rim, rimWidth) {
    const r = box.w * BODY_PLATE_RADIUS;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, r);
    else ctx.rect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = fill;
    ctx.fill();
    if (!rim) return;
    const half = rimWidth / 2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(
        box.x + half, box.y + half,
        box.w - rimWidth, box.h - rimWidth,
        Math.max(0, r - half),
      );
    } else {
      ctx.rect(box.x + half, box.y + half, box.w - rimWidth, box.h - rimWidth);
    }
    ctx.lineWidth = rimWidth;
    ctx.strokeStyle = rim;
    ctx.stroke();
  }

  // Draw one stat item: its plate, then the symbol over the number, the two
  // rows centred on the plate as one block. Everything is placed by INK — the
  // symbol's centre and the number's baseline — so the pair sits optically
  // centred whatever shape the symbol is.
  function drawBodyStatItem(ctx, item, box, fit) {
    const cx = box.x + box.w / 2;
    const top = box.y + (box.h - fit.blockH) / 2;
    ctx.save();
    drawBodyPlate(ctx, box, BODY_ITEM_PLAQUE);
    const symbol = fit.symbol;
    if (symbol) {
      const symMidY = top + symbol.inkH / 2;
      const mark = STAT_MARK[item.mark];
      if (mark) {
        mark.draw(
          ctx,
          cx - symbol.inkW / 2 + symbol.boxDX,
          symMidY + symbol.boxDY,
          symbol.boxH,
        );
      } else {
        ctx.font = symbol.font;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = item.iconColor || BODY_ITEM_TEXT;
        ctx.fillText(item.icon, cx, symMidY + symbol.baselineDY);
      }
    }
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = BODY_ITEM_TEXT;
    ctx.fillText(fit.text, cx, top + fit.blockH);
    ctx.restore();
  }

  // Draw the head's letter plate: the owning player's colour behind a white
  // letter, rimmed in white so the plate still reads when its fill IS the
  // body colour around it (an unowned unit), and the letter carries a dark
  // halo so it survives a light owner colour.
  function drawBodyLetter(ctx, item, box, fit) {
    ctx.save();
    drawBodyPlate(
      ctx, box, item.fill,
      "rgba(255, 255, 255, 0.9)", Math.max(1, fit.fontSize * 0.11),
    );
    ctx.font = fit.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, fit.fontSize * 0.16);
    ctx.strokeStyle = "rgba(12, 16, 22, 0.72)";
    ctx.strokeText(item.text, box.x + box.w / 2, box.y + box.h / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(item.text, box.x + box.w / 2, box.y + box.h / 2);
    ctx.restore();
  }

  // THE body-information plan for one unit: which item each body cell carries
  // at this cell size, and whether anything was dropped — which is the whole
  // of the tag rule. Built once per unit per frame and read by BOTH the body
  // pass (which draws it) and the tag pass (which asks only `tagWarranted`),
  // so the board and its tags can never disagree.
  // `opts.owner` is the operator holding the unit (its colour fills the letter
  // square), `opts.turn` the turn being displayed (the buff's countdown).
  function unitBodyInfoPlan(ctx, snake, boardHeight, cellSize, opts) {
    const plan = { placements: [], tagWarranted: true };
    const body = snake && snake.body;
    if (!body || body.length === 0) return plan;
    // A piece is ONE cell: it has no body to write on, so it keeps the unit
    // icon on that cell and the tag it has always had.
    if (isPieceUnit(snake)) return plan;

    const cells = distinctBodyCells(body);
    const owner = opts && opts.owner;
    const unitColor = snake.customizations?.color || snake.color || "#888888";
    const letterItem = {
      key: "letter",
      chip: true,
      text: snake.letter || snake.emoji || "?",
      fill: (owner && owner.color) || unitColor,
    };

    // Flow items, head → tail, in the units table's order.
    const flow = [
      { key: "weight", mark: "anvil", text: String(snake.length ?? body.length) },
    ];
    if (typeof snake.health === "number") {
      flow.push({
        key: "health",
        icon: STAT_ICON.health,
        iconColor: healthBarColor(healthFraction(snake)),
        text: String(snake.health),
      });
    }
    // The buff writes the TURNS it still has to run, and nothing else: its
    // LEVEL is already spelled out by the body's own outline colour — blue for
    // protected, red for extra-vulnerable — so a number for it would say twice
    // what one glance says once. A historic row carrying no expiry has no
    // countdown to write, and so writes nothing; the outline still says the
    // unit is buffed.
    const invulnLevel = snake.invulnerabilityLevel || 0;
    const invulnTurns =
      invulnLevel !== 0
        ? invulnerabilityTurnsRemaining(snake, opts && opts.turn)
        : null;
    if (invulnTurns != null) {
      flow.push({
        ...invulnerabilityMark(invulnLevel),
        key: "invulnerable",
        text: String(invulnTurns),
      });
    }

    const tailIndex = cells.length - 1;
    const stacked = tailStackCount(body);
    // A stack on a cell that IS the head is not a tail the eye can find, and
    // the letter never gives its square up, so there is nothing to reserve.
    const tailItem =
      stacked > 1 && tailIndex > 0 ? { key: "stack", text: `×${stacked}` } : null;

    let dropped = 0;
    const place = (item, cell) => {
      const box = bodyPlateBox(cell, boardHeight, cellSize);
      const fit = item.chip
        ? fitBodyLetter(ctx, item, box)
        : fitBodyStat(ctx, item, box, cellSize);
      if (!fit) {
        dropped++;
        return;
      }
      plan.placements.push({ item, box, fit });
    };

    place(letterItem, cells[0]);
    // The tail's cell is reserved first — it outranks the flow — so the flow
    // stops one cell short whenever a stack has to be shown.
    const lastFlowIndex = tailItem ? tailIndex - 1 : tailIndex;
    let slot = 1;
    for (const item of flow) {
      if (slot > lastFlowIndex) {
        dropped++;
        continue;
      }
      place(item, cells[slot]);
      slot++;
    }
    if (tailItem) place(tailItem, cells[tailIndex]);

    plan.tagWarranted = dropped > 0;
    return plan;
  }

  // Paint a body-information plan onto the board. One plan in, one drawing
  // out — the tag pass reads the very same object.
  function drawUnitBodyInfo(ctx, plan) {
    if (!plan) return;
    for (const { item, box, fit } of plan.placements) {
      if (item.chip) drawBodyLetter(ctx, item, box, fit);
      else drawBodyStatItem(ctx, item, box, fit);
    }
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
  // to a board cell through the SAME CSS-pixel geometry the renderer draws in
  // (boardCellSize over pointerToCanvas), so it stays correct whatever size the
  // board is dragged to and whatever resolution its bitmap is backed at — the
  // buffer is device pixels, the click is CSS pixels, and only one of those is
  // a coordinate system. Returns the board cell `{x, y}` (origin bottom-left,
  // matching the renderer's coordinate system). Callers should range-check
  // against the board.
  function getClickedCell(canvas, board, event) {
    if (!canvas || !board) return null;
    const cellSize = boardCellSize(canvas, board);
    if (!cellSize) return null;
    const point = pointerToCanvas(canvas, event);
    return {
      x: Math.floor(point.x / cellSize),
      y: board.height - 1 - Math.floor(point.y / cellSize),
    };
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

  // Candidate-tint ramp, worst → middling → best. It runs through a slate
  // blue rather than through yellow, because fertile ground IS yellow: a
  // mid-scored candidate must never wear the terrain's colour.
  const CANDIDATE_TINT_STOPS = [
    { r: 214, g: 44, b: 60 }, // crimson — worst of the offered moves
    { r: 78, g: 108, b: 142 }, // slate blue — middling / unranked
    { r: 40, g: 158, b: 78 }, // green — best of the offered moves
  ];
  const CANDIDATE_TINT_ALPHA = 0.52;

  // Tint for a position 0..1 along the ramp, as an rgba() string.
  function candidateTint(normalized) {
    const t = Math.max(0, Math.min(1, normalized));
    const seg = t < 0.5 ? 0 : 1;
    const f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const a = CANDIDATE_TINT_STOPS[seg];
    const b = CANDIDATE_TINT_STOPS[seg + 1];
    const mix = (k) => Math.round(a[k] + (b[k] - a[k]) * f);
    return `rgba(${mix("r")}, ${mix("g")}, ${mix("b")}, ${CANDIDATE_TINT_ALPHA})`;
  }

  function getScoreColor(score, allScores) {
    if (score == null || allScores.length === 0) return candidateTint(0.5);
    const maxScore = Math.max(...allScores);
    const minScore = Math.min(...allScores);
    const range = maxScore - minScore;
    if (range === 0 || allScores.length === 1) {
      return candidateTint(score > 0 ? 0.85 : score < 0 ? 0.15 : 0.5);
    }
    return candidateTint((score - minScore) / range);
  }

  // Rounded-rect path, traced by hand so the renderer never depends on
  // CanvasRenderingContext2D.roundRect being present.
  function roundedRectPath(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  // Candidate move cell: a pale plate that flattens whatever terrain is
  // underneath (fertile stripes, hazard red, bare board), the move's quality
  // tint over it, then an inset ring — a dark halo under a bright inner
  // stroke — so the affordance reads as a ring on ANY background and never as
  // "this cell is fertile" or "this cell is a hazard". The selected candidate
  // swaps the bright stroke for purple and thickens it, keeping the one
  // selected cell unmistakable among its siblings.
  function drawCandidateCell(ctx, x, y, cellSize, tint, isSelected) {
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.fillRect(x, y, cellSize, cellSize);
    ctx.fillStyle = tint || candidateTint(0.5);
    ctx.fillRect(x, y, cellSize, cellSize);
    const inset = cellSize * 0.12;
    roundedRectPath(
      ctx,
      x + inset,
      y + inset,
      cellSize - inset * 2,
      cellSize - inset * 2,
      cellSize * 0.16,
    );
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.lineWidth = Math.max(3, cellSize * 0.14);
    ctx.stroke();
    ctx.strokeStyle = isSelected ? "#e040fb" : "#ffffff";
    ctx.lineWidth = isSelected
      ? Math.max(2.5, cellSize * 0.1)
      : Math.max(1.5, cellSize * 0.06);
    ctx.stroke();
    ctx.restore();
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
        move.color = candidateTint(0.5);
      }
    });

    return moveState;
  }

  function renderBoard(canvas, gameState, moveState, options) {
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
    // Measure the CSS box FIRST, then back the bitmap at the display's
    // resolution for that box. Everything below — this function and every
    // overlay drawn after it — works in the CSS pixels the transform maps.
    const { width: cssWidth, height: cssHeight } = canvasCssSize(canvas);
    const ctx = prepareCanvas(canvas, cssWidth, cssHeight);
    const cellSize = Math.min(cssWidth / board.width, cssHeight / board.height);
    const boardW = board.width * cellSize;
    const boardH = board.height * cellSize;
    const turn = gameState.turn || 0;

    ctx.imageSmoothingEnabled = false;
    // Alpha hygiene: never inherit transparency from a previous draw pass
    // (e.g. an overlay that mutated globalAlpha without restoring it).
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.strokeStyle = "#000000";
    for (let x = 0; x <= board.width; x++) {
      const line = crispStroke(ctx, x * cellSize, 1.5);
      ctx.lineWidth = line.width;
      ctx.beginPath();
      ctx.moveTo(line.pos, 0);
      ctx.lineTo(line.pos, boardH);
      ctx.stroke();
    }
    for (let y = 0; y <= board.height; y++) {
      const line = crispStroke(ctx, y * cellSize, 1.5);
      ctx.lineWidth = line.width;
      ctx.beginPath();
      ctx.moveTo(0, line.pos);
      ctx.lineTo(boardW, line.pos);
      ctx.stroke();
    }

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, boardW - 2, boardH - 2);

    if (board.hazards && board.hazards.length > 0) {
      board.hazards.forEach((hazard) => {
        const x = hazard.x * cellSize;
        const y = (board.height - 1 - hazard.y) * cellSize;
        drawHazardCell(ctx, x, y, cellSize);
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

    // Voronoi territory overlay. `showTerritory: false` skips the WHOLE block,
    // not just the paint: no owner map, no per-snake colour/body maps, no
    // per-cell boundary walk. It is the single gate for every territory grid
    // the board can draw — the turn's partition and a candidate's projected
    // one alike — so switching the overlay off costs the renderer nothing.
    if (moveState && options?.showTerritory !== false) {
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
          drawCandidateCell(
            ctx,
            x,
            y,
            cellSize,
            move.color,
            moveState.selectedMove === (move.key ?? move.direction),
          );
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

    // ONE body-information plan per unit, built before anything is written on
    // a body: the pass below paints it, and the tag pass asks the same object
    // whether anything was dropped. Two readers, one plan, no drift.
    const owners = options?.owners || {};
    const bodyPlans = new Map();
    board.snakes.forEach((snake) => {
      bodyPlans.set(
        snake.id,
        unitBodyInfoPlan(ctx, snake, board.height, cellSize, {
          owner: owners[snake.id] || null,
          turn,
        }),
      );
    });

    board.snakes.forEach((snake) => {
      const stagedForThisSnake = stagedMovesMap[snake.id];
      const head = snake.body[0];
      if (head) {
        const hx = head.x * cellSize;
        const hy = (board.height - 1 - head.y) * cellSize;
        // Health bar first: a south-facing unit's orientation eye lands on
        // the same bottom edge, and the eye is the one that must stay whole.
        // Alive board snakes only — dead snakes render as ghosts/death
        // markers in a separate pass and never reach this loop.
        drawHealthBar(ctx, snake, hx, hy, cellSize);
        // A piece is one cell and keeps its icon (and its eye, and its
        // rotation badge) there; a snake's head cell carries its LETTER
        // instead, drawn with the rest of its body information below.
        if (isPieceUnit(snake)) {
          drawHeadGlyph(ctx, snake, hx, hy, cellSize, {
            stagedRotation: stagedForThisSnake?.rotation || null,
          });
        }
      }

      // The unit's own numbers, along its own body — letter, weight, health,
      // buff, tail stack — in whatever of them this cell size can hold.
      drawUnitBodyInfo(ctx, bodyPlans.get(snake.id));

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

    // Unit tags: the FALLBACK readout, for the units whose own body could not
    // hold everything (`bodyPlans` says which). A compact tag whose letter
    // square sits on a cell diagonally adjacent to the unit's head, carrying
    // its letter, weight, health, buff, and operator name when owned.
    // Placement + hover hit-testing live in renderUnitTags / getNameTagAt.
    renderUnitTags(ctx, canvas, board, cellSize, options, bodyPlans, turn);

    // Dead-head markers (drawn last so they sit on top of live snakes). This is
    // the SINGLE centralized death-rendering path shared by live play, /play
    // historic scrubbing, and /history. We build one unified list of death
    // entries, then derive each snake's authoritative final cell + intended
    // (staged) cell the same way for every consumer:
    //   - `actual` (solid marker): the server-decided final cell. Taken from an
    //     explicit actualHead (history: last-known head stepped by server_move)
    //     when present, else the engine's authoritative `deathCells` map
    //     (pieces: the exact cell the unit died on — mid-path for a slider
    //     stopped in flight), else derived from the authoritative `lastMoves`
    //     map (snakes: last-known head stepped one cell in the recorded
    //     direction). Same sources for our units and enemies.
    //   - `intended` (shadow marker): the move we actually submitted. Taken from
    //     an explicit intendedHead (history: last-known head stepped by
    //     submitted_move) when present, else the `submittedMoves` map (live:
    //     client-tracked committed move), else the staged-move map. Only drawn
    //     when it differs from the server-decided cell.
    //   - The "unknown ?" marker at the last-known head is the degenerate
    //     case: it draws only when the unit is genuinely absent from every
    //     authoritative source (no actualHead, no deathCells entry, no
    //     lastMoves entry) — i.e. the wire carries no final position at all.
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
    // Dead pieces' authoritative death cells, keyed by unit id. Like lastMoves
    // it rides on the rendered game state (logged inside game_state JSONB, so
    // historic scrubbing and /history get it for free); an explicit option can
    // override it.
    const deathCells = options?.deathCells || gameState?.deathCells || null;
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

      // Authoritative final cell: explicit override first, else the engine's
      // per-piece death cell, else lastMoves (snakes).
      let actual = d.actualHead || null;
      if (!actual && deathCells && d.id != null && deathCells[d.id]) {
        actual = deathCells[d.id];
      }
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
        // Degenerate case: the unit is absent from every authoritative source
        // (no explicit head, no deathCells entry, no lastMoves entry) → "?"
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
  // Rects are in CSS-PIXEL space — the coordinate system the renderer draws in,
  // which is the canvas's own space only up to the resolution transform.
  const _nameTagRects = new WeakMap();

  // Where the pointer is with respect to ONE unit: on nothing of its own, on
  // one of the unit's BODY CELLS, or on the unit's own TAG.
  const TAG_HOVER = { none: "none", unit: "unit", tag: "tag" };

  // The three tag display modes an Alt tap cycles through, in cycle order:
  //   always  every warranted tag is drawn
  //   ours    only OUR TEAM's are drawn by default; everyone else's wait for
  //           a hover — the working mode, where our own units read at a glance
  //           and a crowded enemy line stays quiet until asked
  //   never   none are drawn by default
  // The mode is a global display preference; whether one unit's tag is up by
  // default is that mode crossed with whose unit it is, which is all
  // tagsHiddenFor answers.
  const TAG_MODE = { always: "always", ours: "ours", never: "never" };
  const TAG_MODE_ORDER = [TAG_MODE.always, TAG_MODE.ours, TAG_MODE.never];
  // How each mode says its name — on the shortcuts pane, and anywhere else a
  // surface has to tell the reader which one is active.
  const TAG_MODE_LABEL = {
    [TAG_MODE.always]: "all tags shown",
    [TAG_MODE.ours]: "our team's tags shown",
    [TAG_MODE.never]: "tags hidden",
  };

  // Any stored/passed value resolved to a mode. Anything unrecognised — a
  // stale preference, a caller that never set one — reads as "always", the
  // mode that hides nothing.
  function normalizeTagMode(mode) {
    return TAG_MODE_ORDER.includes(mode) ? mode : TAG_MODE.always;
  }

  // The next mode in the cycle, wrapping. One definition, so the Alt tap and
  // any other control that offers the cycle step through the same order.
  function nextTagMode(mode) {
    const i = TAG_MODE_ORDER.indexOf(normalizeTagMode(mode));
    return TAG_MODE_ORDER[(i + 1) % TAG_MODE_ORDER.length];
  }

  // Is THIS unit's tag hidden until hovered, under this mode? The one place
  // the three-mode cycle becomes the two-state per-unit default the hover
  // rules below are written against. `ours` is the caller's team test — a
  // unit on a team we control into.
  function tagsHiddenFor(mode, ours) {
    switch (normalizeTagMode(mode)) {
      case TAG_MODE.never:
        return true;
      case TAG_MODE.ours:
        return !ours;
      default:
        return false;
    }
  }

  // Which hover input a tag reads, given the mode and whose unit it is. The
  // two per-unit defaults take DIFFERENT inputs, and that — not a latch — is
  // what keeps the rule from fighting itself:
  //   default OFF: the unit's BODY is the switch. A hidden tag's would-be rect
  //                says nothing, because a tag drawn over its own unit's body
  //                would otherwise switch itself straight back off the instant
  //                it appeared (the tag-over-body bug).
  //   default ON:  the TAG is the switch. Body hover says nothing — the tag is
  //                already up, and the only gesture left to make is asking it
  //                to step aside.
  // Callers therefore track BOTH pointer inputs and let this pick the one the
  // unit's own default owns; in "ours" mode the two live side by side on one
  // board, which is exactly why the choice is made per unit rather than once.
  function tagHoverState(mode, ours, onUnitBody, onTag) {
    if (tagsHiddenFor(mode, ours)) {
      return onUnitBody ? TAG_HOVER.unit : TAG_HOVER.none;
    }
    return onTag ? TAG_HOVER.tag : TAG_HOVER.none;
  }

  // Tag outline: the band that carries OWNERSHIP across a whole board at a
  // glance, so it is drawn heavy — heavy enough to read colour at arm's
  // length — and heavier still under selection. Both weights scale with the
  // tag's own text size and are floored in pixels, so a small board keeps a
  // band it can be read by. `unowned` is the grey worn by every unit that is
  // not ours to command: a foreign team's unit, or one of our own team's that
  // no operator has taken. Colour is then only ever "someone owns this, on our
  // side" — which is exactly what the eye should find first.
  const TAG_OUTLINE = {
    unowned: "#8d949c",
    width(fontSize, selected) {
      return selected
        ? Math.max(5, fontSize * 0.36)
        : Math.max(2.5, fontSize * 0.16);
    },
  };

  // THE tag-visibility rule. Three inputs decide what one tag does, and
  // nothing else does: the display MODE (the Alt-tap cycle, plumbed through
  // options.tagMode), whether the unit is OURS (which is all the middle mode
  // asks), and the hover state tagHoverState resolved for this unit.
  //   pointer on the unit's body → "solid": hovering a unit CALLS UP its tag
  //                                (default-off mode)
  //   pointer on the unit's tag  → "hidden": the tag steps aside so the board
  //                                under it can be read (default-on mode)
  //   pointer elsewhere          → the default: "hidden" while this unit's
  //                                tags are off, else "solid" / "selected"
  //                                under selection
  // A pure lookup with no history of its own: the mode gate above is what
  // makes each state reachable from one input only.
  // Returned as a name rather than a number so callers cannot invent an
  // in-between state; TAG_ALPHA maps it to the one opacity it draws at.
  // Whether a tag is drawn AT ALL is a separate question the body-information
  // plan answers first (renderUnitTags): a snake carrying every applicable
  // item on its own body never reaches here, in any mode.
  const TAG_ALPHA = { hidden: 0, solid: 0.92, selected: 1 };
  function unitTagVisibility(mode, ours, hover, selected) {
    if (hover === TAG_HOVER.unit) return "solid";
    if (hover === TAG_HOVER.tag) return "hidden";
    if (tagsHiddenFor(mode, ours)) return "hidden";
    return selected ? "selected" : "solid";
  }

  // Width of one stat's icon inside a tag. A drawn mark has a fixed aspect
  // taken from its own box; every other stat icon is a text glyph the canvas
  // measures. Both the layout pass and the draw pass go through here, so a tag
  // can never be measured one way and painted another.
  function statIconWidth(ctx, stat, iconH) {
    const mark = STAT_MARK[stat.mark];
    if (mark) return (iconH * mark.icon.w) / mark.icon.h;
    return ctx.measureText(stat.icon).width;
  }

  // Draw ONE unit tag: a rounded white pill whose LETTER SQUARE is its anchor,
  // sitting on the cell diagonally adjacent to the unit's head. The body
  // carries the unit's WEIGHT behind the silver anvil, its numeric HEALTH
  // behind a heart tinted by the shared health thresholds, its INVULNERABILITY
  // level behind the shared shield/warning icon, and the OPERATOR name when
  // the unit is owned — the same icons the units table uses for the same
  // stats. The tag carries no health BAR: the numeric heart says it, and the
  // unit's own cell already wears the bar.
  // `letterAtEnd` flips the body's reading order: the square stays on the
  // anchor cell while the stats run to its LEFT, which is what lets a tag near
  // the board's right edge extend inward without losing its anchor.
  // The whole tag is one atomic unit: the opacity comes from
  // unitTagVisibility and is applied to every part inside a single
  // save/restore block, so no piece can appear/disappear independently and no
  // alpha can leak.
  function drawUnitTag(ctx, tag, state) {
    const {
      rect,
      fontSize,
      font,
      letterFont,
      padX,
      gap,
      iconGap,
      chipW,
      tagH,
      letterAtEnd,
      letter,
      stats,
      nameText,
      unitColor,
      ownerColor,
      outlineColor,
    } = tag;
    const { selected, visibility } = state;
    const alpha = TAG_ALPHA[visibility];
    if (!alpha) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = "middle";

    // Tag body: white background under the ownership outline (the owning
    // player's colour for a unit of ours, grey for anything we cannot
    // command); the selected unit gets a fatter band of the same colour.
    const r = tagH * 0.3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.w, tagH, r);
    else ctx.rect(rect.x, rect.y, rect.w, tagH);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = TAG_OUTLINE.width(fontSize, selected);
    ctx.strokeStyle = outlineColor || unitColor;
    ctx.stroke();

    const midY = rect.y + tagH / 2 + fontSize * 0.05;

    // Letter square in the unit's colour: the tag's anchor and its primary
    // identifier, drawn larger and heavier than the stats so it carries at any
    // board scale. It takes the anchor end of the pill; the stats take what is
    // left.
    const chipH = tagH - Math.max(3, fontSize * 0.22);
    const chipY = rect.y + (tagH - chipH) / 2;
    const chipX = letterAtEnd
      ? rect.x + rect.w - padX - chipW
      : rect.x + padX;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(chipX, chipY, chipW, chipH, chipH * 0.25);
    else ctx.rect(chipX, chipY, chipW, chipH);
    ctx.fillStyle = unitColor;
    ctx.fill();
    ctx.font = letterFont;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(letter, chipX + chipW / 2, midY);

    // Stat pairs (icon + value), in the units table's icons and order, laid
    // out from whichever end the letter square did not take.
    let x = letterAtEnd ? rect.x + padX : chipX + chipW;
    const iconH = fontSize * 0.92;
    ctx.font = font;
    ctx.textAlign = "left";
    stats.forEach((stat) => {
      if (!letterAtEnd) x += gap;
      const mark = STAT_MARK[stat.mark];
      if (mark) {
        mark.draw(ctx, x, midY, iconH);
      } else {
        ctx.fillStyle = stat.iconColor || "#1a1a1a";
        ctx.fillText(stat.icon, x, midY);
      }
      x += statIconWidth(ctx, stat, iconH) + iconGap;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillText(stat.text, x, midY);
      x += ctx.measureText(stat.text).width;
      if (letterAtEnd) x += gap;
    });

    // Operator name when owned, in that operator's own player colour — the
    // same colour the board gives them everywhere else — so the tag says WHO
    // holds the unit without the reader tracing the outline back to a legend.
    if (nameText) {
      if (!letterAtEnd) x += gap;
      ctx.fillStyle = ownerColor || "#1a1a1a";
      ctx.fillText(nameText, x, midY);
    }
    ctx.restore();
  }

  // One tag per unit head cell, for EVERY unit on the board (owned or not) —
  // the generalization of the old owner name tags. The tag's LETTER SQUARE is
  // its anchor and it sits on a cell DIAGONALLY adjacent to the unit's head
  // (top-right preferred, then top-left / bottom-right / bottom-left), so the
  // tag never covers its own unit's head cell and the letter always names the
  // unit one step away from it. Among the diagonals that keep the tag on the
  // board, the one covering the fewest other unit heads and already-placed
  // tags wins. The body extends rightward from the square; where the right
  // edge is too close it extends leftward instead and the letter moves to the
  // tag's right end, so the square keeps the anchor cell either way.
  // A tag is the FALLBACK, not the default: a unit gets one only when it
  // cannot carry all of its applicable information on its own body, which is
  // the single question `bodyPlans` answers (unitBodyInfoPlan). A snake long
  // enough to spell everything out never wears a tag in ANY mode; a piece,
  // having no body to write on, always warrants one.
  // Styling derives reactively from the selections map; the Alt-tap display
  // cycle arrives via options.tagMode and the pointer's position via
  // options.hoveredUnitId (pointer on the unit's cells) and
  // options.tagHoverUnitId (pointer latched onto the unit's own tag), and
  // unitTagVisibility turns those into the one state each tag draws in.
  // The tag the pointer is latched onto still PUBLISHES its rect while hidden:
  // that rect is how the caller sees the pointer leave it and un-latch.
  function renderUnitTags(
    ctx,
    canvas,
    board,
    cellSize,
    options,
    bodyPlans,
    currentTurn,
  ) {
    const rects = [];
    _nameTagRects.set(canvas, rects);
    const owners = options?.owners || {};
    const selections = options?.selections || {};
    const hoveredId = options?.hoveredUnitId || null;
    const tagHoverId = options?.tagHoverUnitId || null;
    const mode = normalizeTagMode(options?.tagMode);

    // OUR side, by the same team rule the rest of the client uses: the teams
    // the units we control belong to. A unit outside those teams is foreign
    // however it is owned, and wears the grey outline.
    const controlled = options?.controlledSnakeIds;
    const isControlled = (id) =>
      !controlled ? false : controlled.has ? controlled.has(id) : !!controlled[id];
    const ourTeamKeys = new Set(
      board.snakes.filter((s) => isControlled(s.id)).map(getTeamKey),
    );

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
      // Ownership salience: only a unit on OUR side that an operator holds
      // gets a coloured outline. Everything else — every foreign team's unit,
      // and every unclaimed unit of our own — is grey. The same team test is
      // what the "our team's tags" mode reads.
      const ours = ourTeamKeys.has(getTeamKey(snake));
      // The tag is warranted only when the unit's own body could not carry
      // everything. This outranks the display mode entirely: a long-enough
      // snake shows no tag even in "always".
      const plan = bodyPlans && bodyPlans.get(snake.id);
      if (plan && !plan.tagWarranted) return;
      // The unit's own default picks which pointer input this tag reads, so a
      // tag sitting over its own unit's body cannot suppress itself.
      const hover = tagHoverState(
        mode,
        ours,
        hoveredId === snake.id,
        tagHoverId === snake.id,
      );
      const selected = !!selections[snake.id];
      const visibility = unitTagVisibility(mode, ours, hover, selected);
      // Hidden tags are not drawn, so they are not placed or hit-tested
      // either — with ONE exception: a tag that has stepped aside under the
      // pointer is still placed and published, because its rect is what tells
      // the caller the pointer has left it.
      if (visibility === "hidden" && hover !== TAG_HOVER.tag) return;
      const owner = owners[snake.id] || null;
      const unitColor =
        snake.customizations?.color || snake.color || "#888888";
      const outlineColor =
        ours && owner ? owner.color || unitColor : TAG_OUTLINE.unowned;

      // Letter for verbal reference; historic pre-letter units fall back to
      // their emoji, then "?".
      const letter = snake.letter || snake.emoji || "?";
      const weight = snake.length ?? snake.body.length;
      const health = typeof snake.health === "number" ? snake.health : null;
      const frac = health != null ? healthFraction(snake) : 0;
      const invulnLevel = snake.invulnerabilityLevel || 0;

      // Text sizes are floored in PIXELS as well as scaled off the cell, so a
      // small board shrinks the board, not the readout; the letter runs a step
      // larger and heavier than the stats because it is what units are called
      // by out loud.
      const fontSize = Math.max(12, cellSize * 0.38);
      const letterSize = Math.max(17, fontSize * 1.25);
      const font = `${selected ? "600" : "500"} ${fontSize}px sans-serif`;
      const letterFont = `800 ${letterSize}px sans-serif`;
      const padX = fontSize * 0.45;
      const gap = fontSize * 0.45;
      const iconGap = fontSize * 0.16;
      const nameText = owner && owner.name ? owner.name : null;
      // Stat pairs, in the units table's icons and order: weight, health,
      // invulnerability. Weight rides the drawn silver anvil and a negative
      // invulnerability the drawn red hazard mark; the health heart is the one
      // tinted glyph (by the shared thresholds), the shield a plain one.
      const stats = [{ mark: "anvil", iconColor: null, text: String(weight) }];
      if (health != null) {
        stats.push({
          icon: STAT_ICON.health,
          iconColor: healthBarColor(frac),
          text: String(health),
        });
      }
      // The tag writes the buff's TURNS, same as the body plate — its LEVEL
      // is already spelled out by the body's own outline colour, so a level
      // number here would say twice what the outline says once. No expiry on
      // the wire means no countdown to write, so the tag carries no
      // invulnerability entry at all (same shared helper, same fallback the
      // body plate uses).
      if (invulnLevel !== 0) {
        const invulnTurns = invulnerabilityTurnsRemaining(snake, currentTurn);
        if (invulnTurns != null) {
          stats.push({
            ...invulnerabilityMark(invulnLevel),
            iconColor: null,
            text: String(invulnTurns),
          });
        }
      }

      // The letter square is SQUARE by construction — it is the anchor that
      // lands on a board cell — and widens only for a historic emoji glyph
      // that would not otherwise fit.
      const tagH = Math.max(fontSize * 1.7, letterSize * 1.5);
      const chipH = tagH - Math.max(3, fontSize * 0.22);
      const iconH = fontSize * 0.92;
      ctx.save();
      ctx.font = letterFont;
      const chipW = Math.max(
        chipH,
        ctx.measureText(letter).width + letterSize * 0.4,
      );
      ctx.font = font;
      let contentW = chipW;
      stats.forEach((stat) => {
        contentW +=
          gap +
          statIconWidth(ctx, stat, iconH) +
          iconGap +
          ctx.measureText(stat.text).width;
      });
      if (nameText) contentW += gap + ctx.measureText(nameText).width;
      ctx.restore();
      const tagW = contentW + padX * 2;

      const boardW = board.width * cellSize;
      const boardH = board.height * cellSize;
      const headRow = board.height - 1 - head.y;
      const headTop = headRow * cellSize;
      const ownHeadRect = headRects[snake.id];
      // The four diagonally adjacent cells the letter square can take, in
      // preference order — top-right first, as the tag reads best above and to
      // the right of the unit it names. Steps are in CANVAS space, where rows
      // grow downward.
      const diagonals = [
        { dx: 1, dy: -1 },
        { dx: -1, dy: -1 },
        { dx: 1, dy: 1 },
        { dx: -1, dy: 1 },
      ];
      let best = null;
      let bestScore = Infinity;
      for (const d of diagonals) {
        const col = head.x + d.dx;
        const row = headRow + d.dy;
        // The anchor cell must BE a cell: a diagonal off the board would
        // strand the letter square outside the grid.
        if (col < 0 || col >= board.width) continue;
        if (row < 0 || row >= board.height) continue;
        // Letter square centred on the anchor cell, then pushed clear of the
        // head cell's row — on a cramped board the pill stands taller than a
        // cell, and it must never cover the unit it names.
        const chipX = col * cellSize + (cellSize - chipW) / 2;
        let y = row * cellSize + (cellSize - tagH) / 2;
        y =
          d.dy < 0
            ? Math.min(y, headTop - tagH)
            : Math.max(y, headTop + cellSize);
        // The body extends RIGHTWARD from the square. Where that would run
        // past the board's right edge it extends leftward instead and the
        // square moves to the tag's right end, so the anchor cell keeps the
        // letter either way.
        let letterAtEnd = false;
        let x = chipX - padX;
        if (x + tagW > boardW - 1) {
          const leftwardX = chipX + chipW + padX - tagW;
          if (leftwardX >= 1) {
            x = leftwardX;
            letterAtEnd = true;
          }
        }
        // A tag wider or taller than the board itself: clamp it into view and
        // let the score below prefer a diagonal that keeps the head clear.
        x = Math.max(1, Math.min(x, Math.max(1, boardW - tagW - 1)));
        y = Math.max(1, Math.min(y, Math.max(1, boardH - tagH - 1)));
        const rect = { x, y, w: tagW, h: tagH, letterAtEnd };
        // Covering the unit's OWN head defeats the anchor, so it outweighs any
        // amount of ordinary crowding; other heads and already-placed tags
        // each count one.
        let score = ownHeadRect && intersects(rect, ownHeadRect) ? 100 : 0;
        for (const [sid, hr] of Object.entries(headRects)) {
          if (sid === snake.id) continue;
          if (intersects(rect, hr)) score++;
        }
        for (const pr of placed) {
          if (intersects(rect, pr)) score++;
        }
        if (score < bestScore) {
          bestScore = score;
          best = rect;
        }
        if (score === 0) break;
      }
      // No diagonal cell exists at all (a 1×1 board): nothing to anchor to.
      if (!best) return;

      drawUnitTag(
        ctx,
        {
          rect: best,
          fontSize,
          font,
          letterFont,
          padX,
          gap,
          iconGap,
          chipW,
          tagH,
          letterAtEnd: best.letterAtEnd,
          letter,
          stats,
          nameText,
          unitColor,
          ownerColor: owner && owner.color ? owner.color : null,
          outlineColor,
        },
        { selected, visibility },
      );

      placed.push(best);
      rects.push({ snakeId: snake.id, ...best });
    });
  }

  // Hit-test a mouse event against the unit-tag rects from the last render.
  // Returns the unit's snake id, or null. The rects were recorded in the
  // renderer's CSS-pixel space, which is exactly what pointerToCanvas answers
  // in (same principle as getClickedCell).
  function getNameTagAt(canvas, event) {
    const rects = _nameTagRects.get(canvas);
    if (!rects || rects.length === 0) return null;
    const point = pointerToCanvas(canvas, event);
    for (const r of rects) {
      if (
        point.x >= r.x &&
        point.x <= r.x + r.w &&
        point.y >= r.y &&
        point.y <= r.y + r.h
      ) {
        return r.snakeId;
      }
    }
    return null;
  }

  // Candidate-move overlay: one transparent button per candidate cell, sized
  // and positioned in CSS pixels over the canvas. The buttons carry no label
  // of their own — the on-board unit tags are the board's hover readout, and
  // a second hover surface over the same cells would fight them.
  function createBoardOverlay(
    overlayEl,
    canvas,
    board,
    moveState,
    onCellClick,
  ) {
    overlayEl.innerHTML = "";
    // The overlay is HTML, so it is laid out in CSS pixels — the same units the
    // renderer draws in — and needs no resolution correction of its own. It is
    // pinned to the canvas's CONTENT box (offsetLeft/Top land on the border
    // box) so its cells sit exactly on the drawn ones at any board size.
    const { width: displayWidth, height: displayHeight } = canvasCssSize(canvas);
    overlayEl.style.width = displayWidth + "px";
    overlayEl.style.height = displayHeight + "px";
    overlayEl.style.left = canvas.offsetLeft + (canvas.clientLeft || 0) + "px";
    overlayEl.style.top = canvas.offsetTop + (canvas.clientTop || 0) + "px";
    const displayCellSize = boardCellSize(canvas, board);

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
      overlayEl.appendChild(button);
    });
  }

  // Single source of truth for team identity on the client, mirroring the
  // server-side TeamDetector rule: teamID → squad → color → snake id.
  function getTeamKey(snake) {
    if (!snake) return "";
    return snake.teamID || snake.squad || snake.customizations?.color || snake.color || snake.id;
  }

  // THE unit ordering: by letter rank (A, B, C…), which is how players name
  // their units out loud. Letterless units (historic emoji-era rows) sort
  // after every lettered one, by name then id, so the order is total and
  // stable. Shared by the units table and Tab cycling so the two can never
  // disagree about "the next unit".
  function compareUnitsByLetter(a, b) {
    const la = (a && a.letter) || "";
    const lb = (b && b.letter) || "";
    if (la !== lb) {
      if (!la) return 1;
      if (!lb) return -1;
      return la < lb ? -1 : 1;
    }
    const na = (a && a.name) || "";
    const nb = (b && b.name) || "";
    if (na !== nb) return na < nb ? -1 : 1;
    const ia = (a && a.id) || "";
    const ib = (b && b.id) || "";
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  }

  // Every unit that can be selected/inspected against a given board: the units
  // standing on it, plus any extra ids the caller already knows about (roster
  // entries for units that have since died, logged perspectives). Inspection
  // is a READ of the board being displayed, so this deliberately depends on
  // nothing else — not on who controls what, not on which units a bot logged
  // decisions for, not on whether a live game is even running.
  function inspectableUnitIds(board, extraIds) {
    const ids = new Set();
    for (const snake of (board && board.snakes) || []) {
      if (snake && snake.id) ids.add(snake.id);
    }
    for (const id of extraIds || []) {
      if (id) ids.add(id);
    }
    return ids;
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
    // The row writes the buff's TURNS, same as the body plate — its LEVEL is
    // already spelled out by the unit's own body outline colour (blue for
    // protected, red for extra-vulnerable), so a level number here would say
    // twice what the outline says once. No expiry on the wire (older logs, or
    // a level already lapsed at the displayed turn) means no countdown to
    // write, so the row carries no invulnerability entry at all — the same
    // shared helper the body plate and the unit tag both ask.
    if (invulnLevel !== 0) {
      const remaining = invulnerabilityTurnsRemaining(snake, currentTurn);
      if (remaining != null) {
        // The shield stays a glyph; the extra-vulnerable end of the scale is
        // the drawn hazard mark, inlined at the row's text height.
        const invulnMark = invulnerabilityMark(invulnLevel);
        const icon = invulnMark.mark ? hazardIconSVG(13) : invulnMark.icon;
        invulnDisplay =
          `<span title="Invulnerability">${icon} ${remaining}</span>`;
      }
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
    // Inline health readout: the shared heart icon, the same red/orange/green
    // bar as the board cell and the unit tag (fraction of the unit's
    // configured maxHealth, on the shared track), plus the raw number.
    // Skipped for dead rows and for historical rows without a health value.
    let healthDisplay = "";
    if (!isDead && typeof snake.health === "number") {
      const frac = healthFraction(snake);
      const fill =
        frac > 0
          ? `<span style="display:block;width:${(frac * 100).toFixed(1)}%;height:100%;background:${healthBarColor(frac)};"></span>`
          : "";
      healthDisplay =
        `<span title="Health" style="display:inline-flex;align-items:center;gap:4px;">` +
        `<span style="color:${healthBarColor(frac)};">${STAT_ICON.health}</span>` +
        `<span style="display:inline-block;width:48px;height:8px;background:${HEALTH_BAR_TRACK};border:1px solid rgba(0,0,0,0.25);border-radius:4px;overflow:hidden;">${fill}</span>` +
        `${snake.health}</span>`;
    }
    // Unit icon: the SAME drawn icon as the unit's board head glyph
    // (unitIconSVG shares its path data with drawUnitIcon), rendered white on
    // the unit's colour box so the row reads like the board cell.
    const unitIcon = unitIconSVG(snake.unitType || "snake", 14);
    // Weight: the unit-generic size stat — body length for snakes, stack
    // weight for pieces.
    const weight = snake.length ?? snake.body.length;
    return `
        <div class="${itemClass}"${clickAttr}>
          <div class="snake-color-box" style="background-color: ${snakeColor}; display: flex; align-items: center; justify-content: center;">${unitIcon}</div>
          <div class="snake-details">
            <div class="snake-name">${glyphPrefix}${snake.name}${isOurSnake ? " (You)" : ""}${deadSuffix}</div>
            <div class="snake-stats">
              <span title="Weight" style="display:inline-flex;align-items:center;gap:4px;">${anvilIconSVG(13)} ${weight}</span>
              ${healthDisplay}
              ${invulnDisplay}
              ${ownerBadge}
            </div>
          </div>
          ${unitIdCopyHTML(snake)}
        </div>
      `;
  }

  // One unit's internal document id, as a control on that unit's OWN row: the
  // id on hover, the id on the clipboard on click. An id belongs beside the
  // unit it names — a single corner tooltip listing every id made the reader
  // match names to lines by eye, and gave them nothing to copy.
  function unitIdCopyHTML(snake) {
    return (
      `<button type="button" class="unit-id-copy" data-copy-id="${snake.id}"` +
      ` title="${snake.id}\nClick to copy" aria-label="Copy unit id">ID</button>`
    );
  }

  // How long the copy control wears its confirmation before reverting.
  const COPY_FEEDBACK_MS = 1100;

  // Copy one unit's id, then say so in place. The async clipboard API is the
  // path; a hidden field plus execCommand is the fallback for an insecure
  // context or a browser that refuses the permission, and a refusal by BOTH
  // shows as a cross rather than as silence.
  function copyUnitId(button) {
    const id = button.getAttribute && button.getAttribute("data-copy-id");
    if (!id) return;
    const clipboard =
      typeof navigator !== "undefined" && navigator.clipboard
        ? navigator.clipboard
        : null;
    if (clipboard && clipboard.writeText) {
      clipboard.writeText(id).then(
        () => flashCopyFeedback(button, true),
        () => flashCopyFeedback(button, copyBySelection(id)),
      );
      return;
    }
    flashCopyFeedback(button, copyBySelection(id));
  }

  // Clipboard fallback: a field off-screen, selected and copied through the
  // legacy command, removed either way.
  function copyBySelection(text) {
    if (typeof document === "undefined" || !document.body) return false;
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    field.style.opacity = "0";
    document.body.appendChild(field);
    let copied = false;
    try {
      field.select();
      copied = !!document.execCommand("copy");
    } catch (e) {
      copied = false;
    }
    field.remove();
    return copied;
  }

  // The in-place confirmation on a copy control: a tick, or a cross when the
  // clipboard refused, reverting to the label on its own. The original label is
  // remembered on the element so a second click mid-flash cannot make the tick
  // the label.
  function flashCopyFeedback(button, copied) {
    if (button._copyRevert) clearTimeout(button._copyRevert);
    if (button._copyLabel == null) button._copyLabel = button.textContent;
    const label = button._copyLabel;
    button.textContent = copied ? "\u2713" : "\u2715";
    if (button.classList) {
      button.classList.add(copied ? "copied" : "copy-failed");
    }
    button._copyRevert = setTimeout(() => {
      button.textContent = label;
      if (button.classList) {
        button.classList.remove("copied");
        button.classList.remove("copy-failed");
      }
      button._copyRevert = null;
    }, COPY_FEEDBACK_MS);
  }

  // The markup last written into each units-table container. A units table is
  // rebuilt on every board/selection broadcast, but its CONTENT changes far
  // less often; comparing first means the common repaint touches no DOM at all,
  // so nothing the user is pointing at is torn out from under them.
  const _unitTableHTML = new WeakMap();
  // Containers already carrying the delegated selection handler. The handler is
  // registered ONCE per container and survives every innerHTML rebuild.
  const _unitTableDelegated = new WeakSet();

  // Wire (once) the units table's input — BOTH the row selection and the
  // per-row copy control, through one delegated `pointerdown`. This mirrors the
  // board's delegated handler, and for the same reason: a `click` only fires
  // when press and release land on the SAME element, so a per-row listener
  // silently drops any interaction whose row is replaced between the two — and
  // rows are replaced by every board update, every selection broadcast and
  // every scrub frame. Registering on the container (which outlives the rows)
  // and resolving the target from the event means a rebuild mid-press can never
  // swallow the interaction, and one listener serves N rows however many rows
  // there are — copy controls included, which is why the copy button gets no
  // listener of its own.
  //
  // The copy control sits INSIDE a selectable row, so it is resolved first and
  // returns: copying an id is not a request to select the unit.
  function delegateUnitTableInput(container, options) {
    container._onSelectSnake = (options && options.onSelectSnake) || null;
    if (_unitTableDelegated.has(container)) return;
    _unitTableDelegated.add(container);
    container.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!target || !target.closest) return;
      const copyButton = target.closest("[data-copy-id]");
      if (copyButton) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        copyUnitId(copyButton);
        return;
      }
      const handler = container._onSelectSnake;
      if (!handler) return;
      const row = target.closest("[data-select-snake]");
      if (!row) return;
      handler(row.getAttribute("data-select-snake"));
    });
  }

  // Renders the participants list. With options.groupByTeam the snakes are
  // grouped by team (our team first and visually distinguished) and ordered by
  // letter rank within each team, and rows are made selectable via
  // options.onSelectSnake so a click switches the inspected unit. When the
  // caller supplies options.selectableSnakeIds that set is honoured VERBATIM —
  // the caller owns the selection policy (live control gates on the units we
  // command; history gates on nothing but the board on screen). Without options
  // it falls back to the flat list used by the live play page.
  function renderSnakeInfo(container, gameState, ourSnakeId, options) {
    if (!gameState || !gameState.board) {
      container.innerHTML = "";
      _unitTableHTML.set(container, "");
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

    if (!options || !options.groupByTeam) {
      const flat = allSnakes
        .map((snake) =>
          renderSnakeInfoItem(
            snake, ourSnakeId,
            { dead: deadIds.has(snake.id), owner: ownersMap[snake.id] || null },
            currentTurn,
          ),
        )
        .join("");
      delegateUnitTableInput(container, options);
      container.innerHTML = flat;
      _unitTableHTML.set(container, flat);
      return;
    }

    // Group snakes by team key, each group in letter rank order (A, B, C…).
    const teams = new Map();
    for (const snake of allSnakes) {
      const key = getTeamKey(snake);
      if (!teams.has(key)) teams.set(key, []);
      teams.get(key).push(snake);
    }
    for (const group of teams.values()) group.sort(compareUnitsByLetter);

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
              // An explicit selectable set is the caller's policy, applied as
              // given; without one the default stays "our living team".
              selectable:
                canSelect &&
                (selectableIds
                  ? selectableIds.has(snake.id)
                  : isOurTeam && !deadIds.has(snake.id)),
              active: snake.id === ourSnakeId,
              dead: deadIds.has(snake.id),
              owner: ownersMap[snake.id] || null,
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

    // The delegated handler goes on FIRST and only once, so it is live even
    // for the very first pointerdown after this render.
    delegateUnitTableInput(container, options);

    if (_unitTableHTML.get(container) !== html) {
      _unitTableHTML.set(container, html);
      container.innerHTML = html;
    }
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
        healthLossScore: 0,
        allyCasualtyScore: 0,
        regicideScore: 0,
        enemyRegicideScore: 0,
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
      {
        name: "Health Loss",
        value: breakdown.healthLoss ?? 0,
        weight: breakdown.weights?.healthLoss ?? 0,
        weightedScore: breakdown.weighted?.healthLossScore ?? 0,
        averageWeighted: averageWeighted.healthLossScore ?? 0,
      },
      // Friendly fire and the two team-ending cases. The engine's contests
      // carry no friendly exemption, so our own move can destroy our own
      // units; the value here is the WEIGHT we destroy, which is exactly what
      // team score is counted in.
      {
        name: "Ally Casualty (our weight killed)",
        value: breakdown.allyCasualty ?? 0,
        weight: breakdown.weights?.allyCasualty ?? 0,
        weightedScore: breakdown.weighted?.allyCasualtyScore ?? 0,
        averageWeighted: averageWeighted.allyCasualtyScore ?? 0,
      },
      {
        name: "Regicide (our last king)",
        value: breakdown.regicide ?? 0,
        weight: breakdown.weights?.regicide ?? 0,
        weightedScore: breakdown.weighted?.regicideScore ?? 0,
        averageWeighted: averageWeighted.regicideScore ?? 0,
      },
      {
        name: "Enemy Regicide (their last king)",
        value: breakdown.enemyRegicide ?? 0,
        weight: breakdown.weights?.enemyRegicide ?? 0,
        weightedScore: breakdown.weighted?.enemyRegicideScore ?? 0,
        averageWeighted: averageWeighted.enemyRegicideScore ?? 0,
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
    if (!gameState || !gameState.board) return;
    const board = gameState.board;
    // The same resolution contract as the full board: measure the CSS box,
    // back the bitmap at the display's scale, draw in CSS pixels.
    const { width: cssWidth, height: cssHeight } = canvasCssSize(canvas);
    const ctx = prepareCanvas(canvas, cssWidth, cssHeight);
    const cellSize = Math.min(cssWidth / board.width, cssHeight / board.height);
    const boardW = board.width * cellSize;
    const boardH = board.height * cellSize;

    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.strokeStyle = "#000000";
    for (let x = 0; x <= board.width; x++) {
      const line = crispStroke(ctx, x * cellSize, 1);
      ctx.lineWidth = line.width;
      ctx.beginPath();
      ctx.moveTo(line.pos, 0);
      ctx.lineTo(line.pos, boardH);
      ctx.stroke();
    }
    for (let y = 0; y <= board.height; y++) {
      const line = crispStroke(ctx, y * cellSize, 1);
      ctx.lineWidth = line.width;
      ctx.beginPath();
      ctx.moveTo(0, line.pos);
      ctx.lineTo(boardW, line.pos);
      ctx.stroke();
    }

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, boardW - 2, boardH - 2);

    if (board.hazards && board.hazards.length > 0) {
      board.hazards.forEach((hazard) => {
        const x = hazard.x * cellSize;
        const y = (board.height - 1 - hazard.y) * cellSize;
        drawHazardCell(ctx, x, y, cellSize);
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
    unitTagVisibility,
    tagHoverState,
    tagsHiddenFor,
    normalizeTagMode,
    nextTagMode,
    TAG_HOVER,
    TAG_MODE,
    TAG_MODE_ORDER,
    TAG_MODE_LABEL,
    unitBodyInfoPlan,
    tailStackCount,
    getSnakeGap,
    distinctBodyCells,
    invulnerabilityTurnsRemaining,
    invulnerabilityMark,
    STAT_ICON,
    TAG_OUTLINE,
    drawUnitIcon,
    rotationGlyph,
    drawRotationBadge,
    unitIconSVG,
    anvilIconSVG,
    hazardIconSVG,
    findSnakeAtCell,
    findTerritoryOwnerAtCell,
    isPieceUnit,
    renderScale,
    prepareCanvas,
    canvasCssSize,
    boardCellSize,
    pointerToCanvas,
    watchRenderScale,
    unitDrawsOrientationEye,
    compareUnitsByLetter,
    inspectableUnitIds,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = BoardRenderer;
}
