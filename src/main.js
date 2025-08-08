/*
  CloutChase - Slither-style snake with smooth movement and high-fidelity visuals.
  Single-file JS for ease of drop-in use. No external deps.
*/

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // DPI scaling for crisp rendering
  const dpi = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  function resize() {
    const { innerWidth: w, innerHeight: h } = window;
    canvas.width = Math.floor(w * dpi);
    canvas.height = Math.floor(h * dpi);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // World settings
  const WORLD_RADIUS = 3500; // play area radius
  const GRID_SPACING = 60;
  const GRID_COLOR = 'rgba(80, 90, 150, 0.08)';
  const BG_STARS = 250;

  // Player snake settings
  const BASE_SPEED = 2.4; // world units per frame
  const BOOST_MULTIPLIER = 1.8;
  const TURN_RATE = 0.075; // radians per frame (smoother turning)
  const SEGMENT_SPACING = 6.5;
  const BASE_RADIUS = 6; // minimal snake thickness
  const INITIAL_LENGTH = 70; // starting length

  // Food settings
  const FOOD_COUNT = 650;
  const FOOD_RADIUS_RANGE = [2.2, 4.8];
  const FOOD_RESPAWN_TIME = 3500; // ms

  // Camera settings (split-screen)
  const CAMERA_LERP = 0.065;
  const snakeCam = { x: 0, y: 0, z: 1 };
  const pacCam = { x: 0, y: 0, z: 1 };
  // Legacy aliases used by pointer math and pre-refactor helpers
  let cameraX = snakeCam.x;
  let cameraY = snakeCam.y;
  let cameraZoom = snakeCam.z;
  // Active viewport role for conditional UI (e.g., arrows)
  let currentViewportRole = null; // 'snake' | 'pacman' | null

  // Utility functions
  const rand = (min, max) => Math.random() * (max - min) + min;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };

  // Input state
  const input = {
    targetAngle: 0,
    boost: false,
    usingPointer: false,
    pointerWorldX: 0,
    pointerWorldY: 0,
  };

  function worldFromScreen(x, y) {
    const cx = canvas.width / dpi / 2;
    const cy = canvas.height / dpi / 2;
    const wx = (x - cx) / cameraZoom + cameraX;
    const wy = (y - cy) / cameraZoom + cameraY;
    return { x: wx, y: wy };
  }

  // Mouse/touch boost (steering via keyboard for split-screen)
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) input.boost = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.boost = false;
  });

  // Touch: move to steer; double-tap or two-finger to boost
  let lastTouchTime = 0;
  canvas.addEventListener('touchstart', (e) => {
    const now = Date.now();
    if (now - lastTouchTime < 300) input.boost = true;
    lastTouchTime = now;
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    // no-op
  }, { passive: true });
  canvas.addEventListener('touchend', () => {
    input.boost = false;
  });

  // Keyboard steering fallback
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "w", "a", "s", "d"].includes(e.key)) {
      e.preventDefault();
    }
    keys.add(e.key);
    if (e.key === ' ') input.boost = true;
  }, { passive: false });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key);
    if (e.key === ' ') input.boost = false;
  });

  // Procedural star background outside world for depth
  const stars = Array.from({ length: BG_STARS }, () => ({
    x: rand(-WORLD_RADIUS * 2, WORLD_RADIUS * 2),
    y: rand(-WORLD_RADIUS * 2, WORLD_RADIUS * 2),
    r: rand(0.6, 1.8),
    a: rand(0.25, 0.7)
  }));

  // Food pellets
  const palette = [
    '#7dd3fc', '#a78bfa', '#f472b6', '#fca5a5', '#fdba74', '#fde68a', '#86efac'
  ];
  const foods = [];
  function spawnFood() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * WORLD_RADIUS * 0.96;
    foods.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      r: rand(FOOD_RADIUS_RANGE[0], FOOD_RADIUS_RANGE[1]),
      c: palette[(Math.random() * palette.length) | 0],
      t: 0,
    });
  }
  for (let i = 0; i < FOOD_COUNT; i++) spawnFood();

  // Snake body as a deque of points; head at index 0
  const snake = {
    points: [], // each: { x, y, angle }
    lengthTarget: INITIAL_LENGTH,
    lengthActual: INITIAL_LENGTH,
    angle: 0,
    speed: BASE_SPEED,
    color: '#7ee7ff',
    radiusActual: BASE_RADIUS,
    radiusTarget: BASE_RADIUS,
  };

  function resetSnake() {
    snake.points.length = 0;
    const startX = rand(-200, 200);
    const startY = rand(-200, 200);
    snake.angle = rand(0, Math.PI * 2);
    snake.lengthTarget = INITIAL_LENGTH;
    snake.lengthActual = INITIAL_LENGTH;
    snake.radiusActual = BASE_RADIUS;
    snake.radiusTarget = BASE_RADIUS;
    let d = 0;
    while (d < snake.lengthActual) {
      snake.points.push({ x: startX - Math.cos(snake.angle) * d, y: startY - Math.sin(snake.angle) * d, angle: snake.angle });
      d += SEGMENT_SPACING;
    }
  }
  resetSnake();

  // Pacman (Player 2)
  const pacman = {
    x: 280,
    y: -180,
    angle: 0,
    speed: 2.8,
    radius: 12,
    mouthPhase: 0,
  };
  function resetPacman() {
    const head = snake.points[0];
    let px = rand(-600, 600), py = rand(-600, 600);
    for (let i = 0; i < 10; i++) {
      px = rand(-600, 600);
      py = rand(-600, 600);
      if (Math.hypot(px - head.x, py - head.y) > 500) break;
    }
    pacman.x = px; pacman.y = py;
    pacman.angle = rand(0, Math.PI * 2);
    pacman.mouthPhase = 0;
  }
  resetPacman();

  let gameOver = null; // 'pacman' | 'snake'
  let gameOverTimer = 0; // ms since game over started

  // HUD elements
  const scoreEl = document.getElementById('score');
  const lengthEl = document.getElementById('length');
  let score = 0;

  // Main update
  let lastTime = performance.now();
  function update(dt) {
    if (gameOver) return;

    // P1 Snake: WASD steering
    let target = snake.angle;
    const turnFactor = TURN_RATE * (dt / (1000 / 60));
    if (keys.has('a')) target -= turnFactor * 10;
    if (keys.has('d')) target += turnFactor * 10;
    if (keys.has('w')) snake.speed = BASE_SPEED * 1.2;
    if (keys.has('s')) snake.speed = BASE_SPEED * 0.8;
    input.targetAngle = target;

    // Smooth turn towards target
    let diff = ((input.targetAngle - snake.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    snake.angle += clamp(diff, -TURN_RATE, TURN_RATE) * (dt / (1000 / 60));

    // Speed & boost
    const boost = input.boost ? BOOST_MULTIPLIER : 1;
    const speed = snake.speed * boost;

    // Advance head
    const head = snake.points[0];
    const nextX = head.x + Math.cos(snake.angle) * speed;
    const nextY = head.y + Math.sin(snake.angle) * speed;
    snake.points.unshift({ x: nextX, y: nextY, angle: snake.angle });

    // Maintain spacing by trimming tail based on target length
    let accumulated = 0;
    for (let i = 1; i < snake.points.length; i++) {
      const p = snake.points[i - 1];
      const q = snake.points[i];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      accumulated += Math.hypot(dx, dy);
      if (accumulated > snake.lengthTarget) {
        snake.points.length = i + 1; // keep i (tail point) for smoothness
        break;
      }
    }

    // Clamp within world
    const newHead = snake.points[0];
    const lenFromCenter = Math.hypot(newHead.x, newHead.y);
    if (lenFromCenter > WORLD_RADIUS * 0.995) {
      // Slide along boundary instead of sticking
      const nx = newHead.x / lenFromCenter;
      const ny = newHead.y / lenFromCenter;
      // place slightly inside boundary
      const margin = WORLD_RADIUS - 2;
      newHead.x = nx * margin;
      newHead.y = ny * margin;
      // compute slide direction by removing outward normal component
      const vx = Math.cos(snake.angle);
      const vy = Math.sin(snake.angle);
      const dotOut = vx * nx + vy * ny; // outward component
      let sx = vx - nx * (dotOut + 0.12); // bias inward
      let sy = vy - ny * (dotOut + 0.12);
      const sm = Math.hypot(sx, sy) || 1;
      sx /= sm; sy /= sm;
      // small step to avoid resting on boundary
      newHead.x += sx * 0.5;
      newHead.y += sy * 0.5;
      snake.angle = Math.atan2(sy, sx);
    }

    // Eat food
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      const d2 = dist2(f.x, f.y, newHead.x, newHead.y);
      const effectiveRadius = snake.radiusActual;
      const eatR = (effectiveRadius + 4) * (effectiveRadius + 4);
      if (d2 < eatR) {
        // Eat
        score += Math.round(5 + f.r * 2);
        snake.lengthTarget += 14 + f.r * 4; // grow more per food
        // Respawn later
        const respawnDelay = FOOD_RESPAWN_TIME + Math.random() * 2500;
        setTimeout(() => {
          spawnFood();
        }, respawnDelay);
        foods.splice(i, 1);
      }
    }

    // Thickness growth based on length; smooth towards target
    const growth = Math.max(0, snake.lengthTarget - INITIAL_LENGTH);
    snake.radiusTarget = clamp(BASE_RADIUS + growth * 0.02, BASE_RADIUS, 28);
    const lerpFactor = 0.09 * (dt / (1000 / 60));
    snake.radiusActual = lerp(snake.radiusActual, snake.radiusTarget, lerpFactor);

    // P2 Pacman movement: Arrow keys
    let dirX = 0, dirY = 0;
    if (keys.has('ArrowLeft')) dirX -= 1;
    if (keys.has('ArrowRight')) dirX += 1;
    if (keys.has('ArrowUp')) dirY -= 1;
    if (keys.has('ArrowDown')) dirY += 1;
    if (dirX !== 0 || dirY !== 0) {
      const mag = Math.hypot(dirX, dirY) || 1;
      dirX /= mag; dirY /= mag;
      pacman.angle = Math.atan2(dirY, dirX);
    }
    pacman.x += Math.cos(pacman.angle) * pacman.speed;
    pacman.y += Math.sin(pacman.angle) * pacman.speed;
    // clamp pacman in world
    const pl = Math.hypot(pacman.x, pacman.y);
    if (pl > WORLD_RADIUS) {
      const nx = pacman.x / pl, ny = pacman.y / pl;
      pacman.x = nx * WORLD_RADIUS * 0.995;
      pacman.y = ny * WORLD_RADIUS * 0.995;
      pacman.angle = Math.atan2(-nx, ny) + Math.PI / 2;
    }

    pacman.mouthPhase += 0.14 * (dt / (1000 / 60));

    // Camera follow and zoom for both views
    const targetZoom = clamp(1.1 - Math.min(0.5, snake.lengthTarget / 2400), 0.5, 1.1) * (input.boost ? 0.95 : 1);
    snakeCam.z = lerp(snakeCam.z, targetZoom, CAMERA_LERP);
    snakeCam.x = lerp(snakeCam.x, newHead.x, CAMERA_LERP);
    snakeCam.y = lerp(snakeCam.y, newHead.y, CAMERA_LERP);

    pacCam.z = lerp(pacCam.z, 1.0, 0.08);
    pacCam.x = lerp(pacCam.x, pacman.x, CAMERA_LERP);
    pacCam.y = lerp(pacCam.y, pacman.y, CAMERA_LERP);

    // HUD update throttled
    if ((update._hudTimer = (update._hudTimer || 0) + dt) > 80) {
      update._hudTimer = 0;
      scoreEl.textContent = String(score);
      lengthEl.textContent = String(Math.round(snake.lengthTarget));
    }
  }

  // Rendering helpers
  function drawBackground() {
    const w = canvas.width / dpi;
    const h = canvas.height / dpi;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(cameraZoom, cameraZoom);
    ctx.translate(-cameraX, -cameraY);

    // Stars far away
    for (const s of stars) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(180,200,255,${s.a})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // World boundary soft glow
    const grd = ctx.createRadialGradient(0, 0, WORLD_RADIUS * 0.92, 0, 0, WORLD_RADIUS * 1.05);
    grd.addColorStop(0, 'rgba(80,170,255,0.02)');
    grd.addColorStop(1, 'rgba(10,10,12,0.8)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS * 1.05, 0, Math.PI * 2);
    ctx.fill();

    // Grid inside world
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += GRID_SPACING) {
      ctx.moveTo(x, -WORLD_RADIUS);
      ctx.lineTo(x, WORLD_RADIUS);
    }
    for (let y = -WORLD_RADIUS; y <= WORLD_RADIUS; y += GRID_SPACING) {
      ctx.moveTo(-WORLD_RADIUS, y);
      ctx.lineTo(WORLD_RADIUS, y);
    }
    ctx.stroke();

    // Edge circle
    ctx.strokeStyle = 'rgba(120,150,255,0.15)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function drawFoods() {
    const w = canvas.width / dpi;
    const h = canvas.height / dpi;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(cameraZoom, cameraZoom);
    ctx.translate(-cameraX, -cameraY);

    for (const f of foods) {
      // soft glow
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 4);
      grad.addColorStop(0, f.c + 'cc');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * 3.5, 0, Math.PI * 2);
      ctx.fill();

      // pellet
      ctx.beginPath();
      ctx.fillStyle = f.c;
      ctx.shadowColor = f.c;
      ctx.shadowBlur = 14;
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  function drawSnake() {
    if (snake.points.length < 2) return;
    ctx.save();
    const w = canvas.width / dpi;
    const h = canvas.height / dpi;
    ctx.translate(w / 2, h / 2);
    ctx.scale(cameraZoom, cameraZoom);
    ctx.translate(-cameraX, -cameraY);

    // Outer glow trail
    ctx.strokeStyle = snake.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = snake.color;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    for (let i = 0; i < snake.points.length; i++) {
      const p = snake.points[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    const bodyRadius = snake.radiusActual;
    ctx.lineWidth = bodyRadius * 1.6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Body with subtle gradient
    ctx.beginPath();
    for (let i = 0; i < snake.points.length; i++) {
      const p = snake.points[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    const head = snake.points[0];
    const grad = ctx.createRadialGradient(head.x, head.y, bodyRadius * 0.4, head.x, head.y, bodyRadius * 3.2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, snake.color);
    ctx.strokeStyle = grad;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = bodyRadius;
    ctx.stroke();

    // Head highlight and eyes
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(snake.angle);
    const headR = bodyRadius + 1.5;

    // glossy head
    const hg = ctx.createRadialGradient(0, 0, 2, -2, -2, headR * 1.6);
    hg.addColorStop(0, 'rgba(255,255,255,0.9)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(0, 0, headR, 0, Math.PI * 2);
    ctx.fill();

    // eyes
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(4.5, -3.2, 2.6, 0, Math.PI * 2);
    ctx.arc(4.5, 3.2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b1024';
    ctx.beginPath();
    ctx.arc(5.3, -3.2, 1.3, 0, Math.PI * 2);
    ctx.arc(5.3, 3.2, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Entity-centric enemy arrow (retro) based on viewport role
    if (currentViewportRole === 'snake') {
      // Snake shows enemy (Pacman) direction in Pacman yellow
      drawDirectionalIndicator(head.x, head.y, pacman.x, pacman.y, bodyRadius, 'rgba(255,235,120,0.95)');
    }

    ctx.restore();
  }

  function drawPacman() {
    ctx.save();
    const w = canvas.width / dpi;
    const h = canvas.height / dpi;
    ctx.translate(w / 2, h / 2);
    ctx.scale(cameraZoom, cameraZoom);
    ctx.translate(-cameraX, -cameraY);

    // Proper body: full yellow disc, then subtract animated mouth wedge
    ctx.shadowColor = 'rgba(255, 224, 64, 0.9)';
    ctx.shadowBlur = 22;
    const mouth = 0.1 + Math.abs(Math.sin(pacman.mouthPhase)) * 0.35; // radians
    // draw full disc
    ctx.beginPath();
    ctx.arc(pacman.x, pacman.y, pacman.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd54a';
    ctx.fill();
    // punch out mouth
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(pacman.x, pacman.y);
    ctx.arc(pacman.x, pacman.y, pacman.radius + 0.6, pacman.angle - mouth, pacman.angle + mouth, false);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;

    // eye
    const ex = pacman.x + Math.cos(pacman.angle - Math.PI / 2) * (pacman.radius * 0.35);
    const ey = pacman.y + Math.sin(pacman.angle - Math.PI / 2) * (pacman.radius * 0.35);
    ctx.fillStyle = '#0b1024';
    ctx.beginPath();
    ctx.arc(ex, ey, pacman.radius * 0.18, 0, Math.PI * 2);
    ctx.fill();

    if (currentViewportRole === 'pacman' && snake.points[0]) {
      const head = snake.points[0];
      // Pacman shows enemy (Snake) direction in Snake blue
      drawDirectionalIndicator(pacman.x, pacman.y, head.x, head.y, pacman.radius, 'rgba(126,231,255,0.95)');
    }

    ctx.restore();
  }

  // Retro entity-centric arrow (used within each viewport)
  function drawDirectionalIndicator(fromX, fromY, toX, toY, baseRadius, color) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const r = baseRadius + 18;
    const px = fromX + Math.cos(angle) * r;
    const py = fromY + Math.sin(angle) * r;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    const size = Math.max(10, Math.min(18, baseRadius * 1.05));
    // thick outline + fill for retro look
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, size * 0.75);
    ctx.lineTo(-size * 0.2, 0);
    ctx.lineTo(-size * 0.6, -size * 0.75);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  // Geometry helpers for encircle detection
  function computeRaySegmentHitDistance(rayOrigin, rayDir, segA, segB, radius) {
    // rayDir should be normalized
    const ex = segB.x - segA.x;
    const ey = segB.y - segA.y;
    const r0x = rayOrigin.x - segA.x;
    const r0y = rayOrigin.y - segA.y;
    const A = 1; // |rayDir|^2
    const B = rayDir.x * ex + rayDir.y * ey;
    const C = ex * ex + ey * ey;
    const D = rayDir.x * r0x + rayDir.y * r0y;
    const E = ex * r0x + ey * r0y;
    const denom = A * C - B * B;
    let s, t;
    if (denom > 1e-6) {
      s = (B * E - C * D) / denom;
      t = (A * E - B * D) / denom;
      if (s < 0) {
        s = 0;
        t = E / C;
      } else if (t < 0) {
        t = 0;
        s = -D;
        if (s < 0) s = 0;
      } else if (t > 1) {
        t = 1;
        s = B - D;
        if (s < 0) s = 0;
      }
    } else {
      // near-parallel: project endpoints
      const toA = { x: segA.x - rayOrigin.x, y: segA.y - rayOrigin.y };
      const toB = { x: segB.x - rayOrigin.x, y: segB.y - rayOrigin.y };
      const sA = toA.x * rayDir.x + toA.y * rayDir.y;
      const sB = toB.x * rayDir.x + toB.y * rayDir.y;
      s = Math.max(0, Math.min(sA, sB));
      // best t at s fixed
      const px = rayOrigin.x + rayDir.x * s;
      const py = rayOrigin.y + rayDir.y * s;
      const vx = px - segA.x, vy = py - segA.y;
      const tRaw = (vx * ex + vy * ey) / (C || 1);
      t = Math.max(0, Math.min(1, tRaw));
    }

    const cx = segA.x + ex * t;
    const cy = segA.y + ey * t;
    const qx = rayOrigin.x + rayDir.x * s;
    const qy = rayOrigin.y + rayDir.y * s;
    const dx = qx - cx;
    const dy = qy - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= radius * radius) return s;
    return Infinity;
  }

  function isPacmanEncircled() {
    // Require significant length and a closed loop around Pacman
    if (snake.lengthTarget < 520) return false;
    const origin = { x: pacman.x, y: pacman.y };
    const snakeThickness = Math.max(snake.radiusActual * 0.95, BASE_RADIUS);
    const directions = 24;
    const maxDist = 700;
    let blocked = 0;
    for (let k = 0; k < directions; k++) {
      const ang = (k / directions) * Math.PI * 2;
      const dir = { x: Math.cos(ang), y: Math.sin(ang) };
      let nearest = Infinity;
      for (let i = 2; i < snake.points.length; i += 2) {
        const a = snake.points[i - 1];
        const b = snake.points[i];
        const s = computeRaySegmentHitDistance(origin, dir, a, b, snakeThickness);
        if (s < nearest) nearest = s;
        if (nearest < maxDist) break;
      }
      if (nearest < maxDist) blocked++;
    }
    // Must be blocked in most directions to count as encircled
    return blocked >= Math.ceil(directions * 0.85);
  }

  function renderViewport(x, y, w, h, cam, role) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // Compute pre-translation so that world draw helpers centered at full canvas
    // effectively render centered at this viewport
    const W = canvas.width / dpi;
    const H = canvas.height / dpi;
    const offsetX = (x + w / 2) - (W / 2);
    const offsetY = (y + h / 2) - (H / 2);
    ctx.translate(offsetX, offsetY);

    // Set active camera
    cameraX = cam.x; cameraY = cam.y; cameraZoom = cam.z;
    currentViewportRole = role;

    drawBackground();
    drawFoods();
    drawSnake();
    drawPacman();

    // No edge indicator; entity-centric arrows are drawn in each role's draw call

    // Poster banner at top of viewport (screen-space)
    ctx.save();
    ctx.translate(-offsetX, -offsetY);
    drawViewportPoster(x, y, w, role);
    ctx.restore();

    ctx.restore();
  }

  function drawViewportPoster(viewX, viewY, viewW, role) {
    const pad = 10;
    const posterH = 56;
    const x = viewX + pad;
    const y = viewY + pad;
    const w = viewW - pad * 2;
    const h = posterH;
    ctx.save();
    // background panel
    const r = 10;
    const gradient = ctx.createLinearGradient(x, y, x, y + h);
    if (role === 'snake') {
      gradient.addColorStop(0, 'rgba(120,200,255,0.18)');
      gradient.addColorStop(1, 'rgba(120,200,255,0.06)');
    } else {
      gradient.addColorStop(0, 'rgba(255,235,120,0.20)');
      gradient.addColorStop(1, 'rgba(255,235,120,0.07)');
    }
    ctx.fillStyle = gradient;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    roundedRectPath(x, y, w, h, r);
    ctx.fill();
    ctx.stroke();

    // retro title text centered
    ctx.fillStyle = role === 'snake' ? 'rgba(120,200,255,1)' : '#ffd54a';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 2.5;
    ctx.font = '20px "Press Start 2P", monospace';
    ctx.textBaseline = 'middle';
    const label = role === 'snake' ? 'SNAKE' : 'PACMAN';
    const textW = ctx.measureText(label).width;
    const tx = x + w / 2 - textW / 2;
    const ty = y + h / 2;
    ctx.strokeText(label, tx, ty);
    ctx.fillText(label, tx, ty);

    // icon
    if (role === 'snake') {
      drawSnakeIcon(x + 22, y + h / 2, 18);
    } else {
      drawPacmanIcon(x + w - 22, y + h / 2, 18);
    }
    ctx.restore();
  }

  function roundedRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawPacmanIcon(cx, cy, radius) {
    ctx.save();
    ctx.shadowColor = 'rgba(255, 224, 64, 0.6)';
    ctx.shadowBlur = 10;
    // full disc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd54a';
    ctx.fill();
    // mouth wedge
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const angle = -Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius + 0.5, -angle, angle, false);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // eye
    ctx.fillStyle = '#0b1024';
    ctx.beginPath();
    ctx.arc(cx + radius * 0.25, cy - radius * 0.25, radius * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSnakeIcon(cx, cy, radius) {
    ctx.save();
    // body circle
    const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.2, cx, cy, radius * 1.2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#7ee7ff');
    ctx.strokeStyle = grad;
    ctx.lineWidth = radius * 0.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    // head
    ctx.fillStyle = '#7ee7ff';
    ctx.beginPath();
    ctx.arc(cx + radius * 0.6, cy, radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // eye
    ctx.fillStyle = '#0b1024';
    ctx.beginPath();
    ctx.arc(cx + radius * 0.75, cy - radius * 0.1, radius * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(50, now - lastTime);
    lastTime = now;

    update(dt);
    // Check Pacman eats snake
    if (!gameOver) {
      const pr = pacman.radius;
      const sr = snake.radiusActual;
      for (let i = 0; i < snake.points.length; i += 2) {
        const sp = snake.points[i];
        const rr = pr + Math.max(sr * (i === 0 ? 1.0 : 0.8), BASE_RADIUS);
        const d2p = dist2(pacman.x, pacman.y, sp.x, sp.y);
        if (d2p < rr * rr) { gameOver = 'pacman'; break; }
      }
    }
    // Check Snake encircles Pacman
    if (!gameOver && isPacmanEncircled()) {
      gameOver = 'snake';
    }
    if (gameOver) {
      gameOverTimer += dt;
    } else {
      gameOverTimer = 0;
    }

    // compose split screen
    const W = canvas.width / dpi;
    const H = canvas.height / dpi;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const halfW = W / 2;
    renderViewport(0, 0, halfW, H, snakeCam, 'snake');
    renderViewport(halfW, 0, halfW, H, pacCam, 'pacman');

    // divider line
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(Math.floor(halfW) - 1, 0, 2, H);

    // (removed) overlay labels for P1/P2

    // Win overlay with blur B/W and smoother fade
    if (gameOver) {
      const t = Math.min(1, gameOverTimer / 1300);
      // grayscale + blur backdrop
      ctx.save();
      ctx.filter = `grayscale(${0.6 + 0.4 * t}) blur(${2 + 3 * t}px)`;
      ctx.drawImage(canvas, 0, 0); // subtle feedback; already drawn scene
      ctx.restore();
      // dark vignette
      ctx.fillStyle = `rgba(0,0,0,${0.25 + t * 0.35})`;
      ctx.fillRect(0, 0, W, H);
      const grad = ctx.createRadialGradient(W / 2, H / 2, Math.max(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * (0.9));
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Winner text
      const sub = gameOver === 'pacman' ? 'PACMAN WINS' : 'SNAKE WINS';
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.floor(56 + 10 * t)}px "Press Start 2P", monospace`;
      ctx.fillStyle = `rgba(255,255,255,${0.95})`;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 6;
      ctx.strokeText(sub, W / 2, H / 2 - 10);
      ctx.fillText(sub, W / 2, H / 2 - 10);
      // subline
      ctx.font = '18px Inter, ui-sans-serif, system-ui, -apple-system';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('Press R to restart', W / 2, H / 2 + 28);
      ctx.restore();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();

// Restart handler
window.addEventListener('keydown', (e) => {
  if ((e.key === 'r' || e.key === 'R') && typeof window !== 'undefined') {
    // Try to access closure bindings via a soft reload
    location.reload();
  }
});

// Intro overlay dismissal
['click','keydown','touchstart'].forEach(evt => {
  window.addEventListener(evt, () => {
    const el = document.getElementById('intro');
    if (el) el.style.display = 'none';
  }, { once: true, passive: true });
});


