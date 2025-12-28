import { useRef, useEffect, useCallback } from 'react';
import { useWorld } from '../state/WorldContext';

interface MinimapProps {
  cameraX: number;
  cameraY: number;
  onNavigate: (x: number, y: number) => void;
}

const MINIMAP_SIZE = 150;
const MINIMAP_SCALE = 0.1; // Each pixel = 10 world units
const VIEWPORT_SIZE = 20; // Approximate viewport indicator size

export function Minimap({ cameraX, cameraY, onNavigate }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { entities } = useWorld();

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Convert click position to world coordinates
    const centerX = MINIMAP_SIZE / 2;
    const centerY = MINIMAP_SIZE / 2;
    const worldX = cameraX + (clickX - centerX) / MINIMAP_SCALE;
    const worldY = cameraY + (clickY - centerY) / MINIMAP_SCALE;

    onNavigate(Math.round(worldX), Math.round(worldY));
  }, [cameraX, cameraY, onNavigate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Draw grid lines
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 1;
    const gridSpacing = 50 * MINIMAP_SCALE; // Grid every 50 world units
    const centerX = MINIMAP_SIZE / 2;
    const centerY = MINIMAP_SIZE / 2;
    const offsetX = (cameraX * MINIMAP_SCALE) % gridSpacing;
    const offsetY = (cameraY * MINIMAP_SCALE) % gridSpacing;

    for (let x = -offsetX; x < MINIMAP_SIZE; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MINIMAP_SIZE);
      ctx.stroke();
    }
    for (let y = -offsetY; y < MINIMAP_SIZE; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(MINIMAP_SIZE, y);
      ctx.stroke();
    }

    // Draw entities
    entities.forEach(entity => {
      const screenX = centerX + (entity.x - cameraX) * MINIMAP_SCALE;
      const screenY = centerY + (entity.y - cameraY) * MINIMAP_SCALE;

      if (screenX < 0 || screenX > MINIMAP_SIZE || screenY < 0 || screenY > MINIMAP_SIZE) {
        return;
      }

      switch (entity.type) {
        case 'player':
          ctx.fillStyle = entity.online ? '#4ade80' : '#6b7280';
          ctx.beginPath();
          ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'building':
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(screenX - 2, screenY - 2, 4, 4);
          break;
        case 'npc':
          ctx.fillStyle = '#a78bfa';
          ctx.beginPath();
          ctx.arc(screenX, screenY, 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'road':
          ctx.fillStyle = '#78716c';
          ctx.fillRect(screenX - 1, screenY - 1, 2, 2);
          break;
      }
    });

    // Draw viewport indicator (center crosshair)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      centerX - VIEWPORT_SIZE / 2,
      centerY - VIEWPORT_SIZE / 2,
      VIEWPORT_SIZE,
      VIEWPORT_SIZE
    );

    // Origin marker if visible
    const originX = centerX - cameraX * MINIMAP_SCALE;
    const originY = centerY - cameraY * MINIMAP_SCALE;
    if (originX >= 0 && originX <= MINIMAP_SIZE && originY >= 0 && originY <= MINIMAP_SIZE) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(originX, originY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [cameraX, cameraY, entities]);

  return (
    <div className="minimap">
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        onClick={handleClick}
        title="Click to navigate"
      />
      <div className="minimap-legend">
        <span><span className="dot player-online" /> Players</span>
        <span><span className="dot building" /> Buildings</span>
      </div>
    </div>
  );
}
