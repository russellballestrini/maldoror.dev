import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useWorld } from '../state/WorldContext';
import { TileProviderWeb, getTerrainImage } from '../world/TileProviderWeb';
import { spriteAtlas } from '../canvas/SpriteAtlas';

const TILE_SIZE = 256;

export function WorldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { camera, entities, showGrid, worldData } = useWorld();
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const frameRef = useRef<number>(0);

  // Initialize tile provider with world seed
  const tileProvider = useMemo(() => {
    const seed = worldData?.seed || '12345';
    return new TileProviderWeb(seed);
  }, [worldData?.seed]);

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Preload visible entity sprites
  useEffect(() => {
    const scaledTileSize = TILE_SIZE * camera.zoom;
    const tilesX = Math.ceil(dimensions.width / scaledTileSize) + 2;
    const tilesY = Math.ceil(dimensions.height / scaledTileSize) + 2;
    const startTileX = Math.floor(camera.x - tilesX / 2);
    const startTileY = Math.floor(camera.y - tilesY / 2);
    const endTileX = startTileX + tilesX;
    const endTileY = startTileY + tilesY;

    // Preload sprites for visible entities
    const urls: string[] = [];
    for (const entity of entities) {
      if (entity.x >= startTileX && entity.x <= endTileX &&
          entity.y >= startTileY && entity.y <= endTileY) {
        if (entity.spriteUrl) {
          urls.push(entity.spriteUrl);
        }
        if (entity.tiles) {
          for (const tile of entity.tiles) {
            urls.push(tile.url);
          }
        }
      }
    }
    spriteAtlas.preloadMultiple(urls);
  }, [camera.x, camera.y, camera.zoom, dimensions, entities]);

  // Render world
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Cancel previous frame
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
    }

    const render = () => {
      // Clear canvas
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);

      const scaledTileSize = TILE_SIZE * camera.zoom;
      const centerX = dimensions.width / 2;
      const centerY = dimensions.height / 2;

      // Calculate visible tile range
      const tilesX = Math.ceil(dimensions.width / scaledTileSize) + 2;
      const tilesY = Math.ceil(dimensions.height / scaledTileSize) + 2;
      const startTileX = Math.floor(camera.x - tilesX / 2);
      const startTileY = Math.floor(camera.y - tilesY / 2);

      // Create a set of road positions for quick lookup
      const roadPositions = new Set<string>();
      for (const entity of entities) {
        if (entity.type === 'road') {
          roadPositions.add(`${entity.x},${entity.y}`);
        }
      }

      // Draw procedural terrain
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const worldX = startTileX + tx;
          const worldY = startTileY + ty;

          // Screen position
          const screenX = centerX + (worldX - camera.x) * scaledTileSize;
          const screenY = centerY + (worldY - camera.y) * scaledTileSize;

          // Check if there's a road here
          if (roadPositions.has(`${worldX},${worldY}`)) {
            ctx.fillStyle = '#4a4540'; // Road color
            ctx.fillRect(screenX, screenY, scaledTileSize + 1, scaledTileSize + 1);
          } else {
            // Get terrain from tile provider
            const terrain = tileProvider.getTerrain(worldX, worldY);
            const terrainImg = getTerrainImage(terrain.id);

            if (terrainImg) {
              // Draw terrain sprite
              ctx.drawImage(terrainImg, screenX, screenY, scaledTileSize, scaledTileSize);
            } else {
              // Fallback to color
              ctx.fillStyle = `rgb(${terrain.color.r}, ${terrain.color.g}, ${terrain.color.b})`;
              ctx.fillRect(screenX, screenY, scaledTileSize + 1, scaledTileSize + 1);
            }
          }
        }
      }

      // Draw grid overlay
      if (showGrid) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        for (let ty = 0; ty <= tilesY; ty++) {
          const worldY = startTileY + ty;
          const screenY = centerY + (worldY - camera.y) * scaledTileSize;
          ctx.beginPath();
          ctx.moveTo(0, screenY);
          ctx.lineTo(dimensions.width, screenY);
          ctx.stroke();
        }

        for (let tx = 0; tx <= tilesX; tx++) {
          const worldX = startTileX + tx;
          const screenX = centerX + (worldX - camera.x) * scaledTileSize;
          ctx.beginPath();
          ctx.moveTo(screenX, 0);
          ctx.lineTo(screenX, dimensions.height);
          ctx.stroke();
        }
      }

      // Sort entities by Y position for proper layering (skip roads, already drawn)
      const renderableEntities = entities
        .filter(e => e.type !== 'road')
        .sort((a, b) => a.y - b.y);

      // Draw buildings first (3x3 tile grids)
      for (const entity of renderableEntities) {
        if (entity.type !== 'building') continue;

        if (entity.tiles && entity.tiles.length > 0) {
          // Draw building tiles
          for (const tile of entity.tiles) {
            const tileWorldX = entity.x + tile.x;
            const tileWorldY = entity.y + tile.y;
            const screenX = centerX + (tileWorldX - camera.x) * scaledTileSize;
            const screenY = centerY + (tileWorldY - camera.y) * scaledTileSize;

            // Skip if off-screen
            if (screenX < -scaledTileSize || screenX > dimensions.width + scaledTileSize ||
                screenY < -scaledTileSize || screenY > dimensions.height + scaledTileSize) {
              continue;
            }

            const img = spriteAtlas.getSync(tile.url);
            if (img) {
              ctx.drawImage(img, screenX, screenY, scaledTileSize, scaledTileSize);
            } else {
              // Draw placeholder
              ctx.fillStyle = '#f59e0b';
              ctx.globalAlpha = 0.5;
              ctx.fillRect(screenX, screenY, scaledTileSize, scaledTileSize);
              ctx.globalAlpha = 1;
            }
          }
        } else {
          // Fallback for buildings without tiles
          const screenX = centerX + (entity.x - camera.x) * scaledTileSize;
          const screenY = centerY + (entity.y - camera.y) * scaledTileSize;
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(screenX, screenY, scaledTileSize * 3, scaledTileSize * 3);
        }
      }

      // Draw players and NPCs
      for (const entity of renderableEntities) {
        if (entity.type !== 'player' && entity.type !== 'npc') continue;

        const screenX = centerX + (entity.x - camera.x) * scaledTileSize;
        const screenY = centerY + (entity.y - camera.y) * scaledTileSize;

        // Skip if off-screen
        if (screenX < -scaledTileSize || screenX > dimensions.width + scaledTileSize ||
            screenY < -scaledTileSize || screenY > dimensions.height + scaledTileSize) {
          continue;
        }

        if (entity.spriteUrl) {
          const img = spriteAtlas.getSync(entity.spriteUrl);
          if (img) {
            // Draw sprite centered on tile, positioned at feet
            ctx.drawImage(
              img,
              screenX - scaledTileSize / 2 + scaledTileSize / 2,
              screenY - scaledTileSize + scaledTileSize / 2,
              scaledTileSize,
              scaledTileSize
            );
          } else {
            // Draw placeholder
            drawEntityPlaceholder(ctx, entity, screenX, screenY, scaledTileSize);
          }
        } else {
          drawEntityPlaceholder(ctx, entity, screenX, screenY, scaledTileSize);
        }

        // Draw entity name
        if (entity.name && camera.zoom >= 0.5) {
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.max(10, 12 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          // Add text shadow for readability
          ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
          ctx.shadowBlur = 2;
          ctx.shadowOffsetX = 1;
          ctx.shadowOffsetY = 1;

          ctx.fillText(entity.name, screenX + scaledTileSize / 2, screenY + scaledTileSize / 2 + 5);

          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;

          // Draw online indicator for players
          if (entity.type === 'player') {
            ctx.beginPath();
            ctx.arc(screenX + scaledTileSize / 2 - ctx.measureText(entity.name).width / 2 - 8,
                    screenY + scaledTileSize / 2 + 12, 4, 0, Math.PI * 2);
            ctx.fillStyle = entity.online ? '#4ade80' : '#6b7280';
            ctx.fill();
          }
        }
      }

      // Draw origin marker
      const originScreenX = centerX - camera.x * scaledTileSize;
      const originScreenY = centerY - camera.y * scaledTileSize;
      if (originScreenX >= -20 && originScreenX <= dimensions.width + 20 &&
          originScreenY >= -20 && originScreenY <= dimensions.height + 20) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(originScreenX - 15, originScreenY);
        ctx.lineTo(originScreenX + 15, originScreenY);
        ctx.moveTo(originScreenX, originScreenY - 15);
        ctx.lineTo(originScreenX, originScreenY + 15);
        ctx.stroke();
      }
    };

    // Use requestAnimationFrame for smooth rendering
    frameRef.current = requestAnimationFrame(render);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [camera.x, camera.y, camera.zoom, dimensions, entities, showGrid, tileProvider]);

  // Mouse handlers for panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;

    const dx = (dragStart.x - e.clientX) / (TILE_SIZE * camera.zoom);
    const dy = (dragStart.y - e.clientY) / (TILE_SIZE * camera.zoom);

    camera.pan(dx, dy);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, [isDragging, dragStart, camera]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      camera.zoomIn();
    } else {
      camera.zoomOut();
    }
  }, [camera]);

  return (
    <div
      ref={containerRef}
      className="world-canvas-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
      />
    </div>
  );
}

// Helper function to draw entity placeholders
function drawEntityPlaceholder(
  ctx: CanvasRenderingContext2D,
  entity: { type: string; online?: boolean },
  screenX: number,
  screenY: number,
  scaledTileSize: number
): void {
  switch (entity.type) {
    case 'player':
      ctx.fillStyle = entity.online ? '#4ade80' : '#6b7280';
      ctx.beginPath();
      ctx.arc(screenX + scaledTileSize / 2, screenY, scaledTileSize / 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'npc':
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath();
      ctx.arc(screenX + scaledTileSize / 2, screenY, scaledTileSize / 5, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}
