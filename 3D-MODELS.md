# 3D Model Conversion Status

## Overview
Converting 2D sprites to 3D GLB models using Meshy.ai API for the web-3d viewer.

## Converted Models

### Players (8/8 complete)
| ID | Status |
|----|--------|
| 165c2465-6d0c-4c73-9f2c-b629a58b5a9c | Done |
| 43653cb9-0959-449f-8129-25f16a632282 | Done |
| 44fc7bc0-9210-4240-9054-1cdad49b8199 | Done |
| 9bece1f1-c166-4e9c-a0f6-868556c68adf | Done |
| be4580bc-5c9c-412f-a1a1-f4cf5cbadc9a | Done |
| d2b688ae-0517-4107-8618-7c0cc9118b51 | Done |
| e8fb7c55-68f0-412b-989c-3445aa8e2b0c | Done |
| f1339d5f-8b5a-4288-9778-75ab90534b03 | Done |

### NPCs/Autons (7/8 complete)
| ID | Status |
|----|--------|
| 107055db-72e3-42c9-92f0-b71275afb11a | Done |
| 10de172e-ad68-4aa8-9413-5065428df676 | Done |
| 1c7a2e54-524e-4e61-ab15-75d35b46ec5a | Done |
| 39da55e5-9ba1-457d-8ed7-19356083196b | Done |
| 3b6c5717-4e9c-47c9-b30e-bdd5cabdde72 | Done |
| 5b518245-b563-43c9-8eb0-1239a7ce92c2 | Done |
| 9bece1f1-c166-4e9c-a0f6-868556c68adf | Done |
| 465fe31a-f596-4c8d-a214-d73610116fa8 | Failed (timeout) |

### Buildings (7/28 complete)
| ID | Status |
|----|--------|
| 06cb28c4-fe73-4b26-bd77-70e7002a7996 | Done |
| 07e0845d-5447-4a22-adc1-93dd2ce4760e | Done |
| 12107ee0-6a42-404c-912a-4bd4b267c56c | Done |
| 1f39731d-8a58-4b70-b567-9649858a7f64 | Done |
| 32f6a10b-6136-49a7-8de2-b1a9b30464d9 | Done |
| 615956fd-9903-4de9-8834-627710e34dd6 | Done |
| acdeb3cd-eabd-4535-a49e-b287e1fb4b52 | Done |

21 buildings remain unconverted (Meshy API timeouts).

## Unified Conversion Script

Convert ALL missing models with auto-deploy to production:

```bash
cd apps/ssh-world
npx tsx src/scripts/convert-all-missing.ts
```

Options:
- `--buildings` - Convert only buildings
- `--npcs` - Convert only NPCs
- `--players` - Convert only players
- `--all` - Convert everything (default)
- `--id=<uuid>` - Convert specific entity

The script:
1. Fetches entity list from production API
2. Checks which GLB models are missing locally
3. Downloads sprite PNGs from production
4. Converts to GLB via Meshy API (~2-5 min per model)
5. Auto-deploys to production container via SCP/Docker

## File Locations

### Local (source)
```
apps/web-3d/public/models/
├── players/*.glb
├── buildings/*.glb
└── npcs/*.glb
```

### Production (inside Docker container)
```
/app/models/
├── players/*.glb
├── buildings/*.glb
└── npcs/*.glb
```

## API Endpoints

- `GET /files/models/players/{id}.glb` - Player 3D model
- `GET /files/models/buildings/{id}.glb` - Building 3D model
- `GET /files/models/npcs/{id}.glb` - NPC 3D model
- `GET /api/entities` - All world entities
- `GET /api/world` - World configuration

## Web-3D Viewer Features (v0.2.0)

### Terrain
- Procedural terrain generation using seeded noise
- 100x100 visible tiles with instanced rendering
- 5 terrain types: grass, dirt, sand, stone, water
- Height variation per terrain type
- Animated reflective water using Three.js Water shader

### Lighting & Atmosphere
- Realistic sky dome with sun position
- PCFSoftShadowMap directional sunlight (4096x4096)
- SSAO (Screen Space Ambient Occlusion)
- Bloom post-processing
- Exponential atmospheric fog

### Entities
- GLB model loading with caching
- Smooth position interpolation for movement
- Always-visible floating name labels (HTML overlay)
- Online/offline status indicators for players
- Fallback to default VRM for missing player models
- Fallback to procedural boxes for missing buildings

### Controls
- WASD/Arrows: Camera movement
- Q/E: Up/Down
- Mouse drag: Orbit camera
- Scroll: Zoom

### UI
- Stats overlay (Players online, NPCs, Buildings)
- Keyboard hints

## Deploy Notes

After each deploy, models must be copied into the new container:
```bash
ssh -p 22022 root@134.199.180.251 "
  docker exec deploy-ssh-world-1 mkdir -p /app/models/players /app/models/buildings /app/models/npcs
  docker cp /opt/maldoror/apps/ssh-world/models/players/. deploy-ssh-world-1:/app/models/players/
  docker cp /opt/maldoror/apps/ssh-world/models/buildings/. deploy-ssh-world-1:/app/models/buildings/
  docker cp /opt/maldoror/apps/ssh-world/models/npcs/. deploy-ssh-world-1:/app/models/npcs/
"
```

## TODO

- [ ] Convert remaining 21 buildings
- [ ] Convert 1 failed NPC (465fe31a)
- [ ] Add volume mount for models in docker-compose to persist across deploys
- [ ] Add minimap overlay
- [ ] Add click-to-focus on entities
- [ ] Add entity selection outlines
