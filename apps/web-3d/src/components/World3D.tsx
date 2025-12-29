import { Suspense, useMemo, useState, useEffect, useRef, createContext, useContext } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Sky, Html } from '@react-three/drei';
import { EffectComposer, Bloom, SSAO } from '@react-three/postprocessing';
import * as THREE from 'three';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { useWorld, type Entity } from '../state/WorldContext';
import { TerrainGenerator, TERRAIN_COLORS, TERRAIN_HEIGHTS, type TerrainType } from '../terrain/TerrainGenerator';

interface FocusContextValue {
  focusedEntity: Entity | null;
  setFocusedEntity: (entity: Entity | null) => void;
  focusTarget: THREE.Vector3 | null;
}

const FocusContext = createContext<FocusContextValue | null>(null);

function useFocus() {
  const context = useContext(FocusContext);
  if (!context) throw new Error('useFocus must be used within FocusContext.Provider');
  return context;
}

const glbCache = new Map<string, THREE.Object3D>();
const glbLoadingPromises = new Map<string, Promise<THREE.Object3D>>();
let cachedDefaultVRM: VRM | null = null;
let defaultVRMPromise: Promise<VRM> | null = null;

const gltfLoader = new GLTFLoader();
gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

function worldTo3D(x: number, y: number, height = 0): [number, number, number] {
  return [x, height, -y];
}

function directionToRotation(direction?: string): number {
  switch (direction) {
    case 'north': return Math.PI;
    case 'east': return Math.PI / 2;
    case 'south': return 0;
    case 'west': return -Math.PI / 2;
    default: return 0;
  }
}

function loadDefaultVRM(): Promise<VRM> {
  if (cachedDefaultVRM) return Promise.resolve(cachedDefaultVRM);
  if (defaultVRMPromise) return defaultVRMPromise;

  defaultVRMPromise = new Promise((resolve, reject) => {
    gltfLoader.load(
      '/vrm/default.vrm',
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM;
        if (vrm) {
          VRMUtils.removeUnnecessaryVertices(vrm.scene);
          vrm.scene.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          cachedDefaultVRM = vrm;
          resolve(vrm);
        } else {
          reject(new Error('No VRM in GLTF'));
        }
      },
      undefined,
      reject
    );
  });

  return defaultVRMPromise;
}

function loadGLB(url: string): Promise<THREE.Object3D> {
  const cached = glbCache.get(url);
  if (cached) return Promise.resolve(cached);

  const loading = glbLoadingPromises.get(url);
  if (loading) return loading;

  const promise = new Promise<THREE.Object3D>((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf: GLTF) => {
        const scene = gltf.scene;
        scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        glbCache.set(url, scene);
        glbLoadingPromises.delete(url);
        resolve(scene);
      },
      undefined,
      (error) => {
        glbLoadingPromises.delete(url);
        reject(error);
      }
    );
  });

  glbLoadingPromises.set(url, promise);
  return promise;
}

function useModel(modelUrl?: string) {
  const [model, setModel] = useState<THREE.Object3D | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const load = async () => {
      try {
        let loadedModel: THREE.Object3D;

        if (modelUrl) {
          const source = await loadGLB(modelUrl);
          loadedModel = (SkeletonUtils as unknown as { clone: (obj: THREE.Object3D) => THREE.Object3D }).clone(source);
        } else {
          const vrm = await loadDefaultVRM();
          loadedModel = (SkeletonUtils as unknown as { clone: (obj: THREE.Object3D) => THREE.Object3D }).clone(vrm.scene);
        }

        if (mounted) {
          setModel(loadedModel);
          setLoading(false);
        }
      } catch {
        try {
          const vrm = await loadDefaultVRM();
          if (mounted) {
            setModel((SkeletonUtils as unknown as { clone: (obj: THREE.Object3D) => THREE.Object3D }).clone(vrm.scene));
            setLoading(false);
          }
        } catch {
          if (mounted) setLoading(false);
        }
      }
    };

    load();
    return () => { mounted = false; };
  }, [modelUrl]);

  return { model, loading };
}

function ReflectiveWater() {

  const waterGeometry = useMemo(() => new THREE.PlaneGeometry(200, 200), []);
  
  const water = useMemo(() => {
    const waterNormals = new THREE.TextureLoader().load(
      'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/waternormals.jpg',
      (texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
    );

    const waterObj = new Water(waterGeometry, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals,
      sunDirection: new THREE.Vector3(1, 1, 1).normalize(),
      sunColor: 0xffffff,
      waterColor: 0x001e0f,
      distortionScale: 3.7,
      fog: true,
    });

    waterObj.rotation.x = -Math.PI / 2;
    waterObj.position.y = -0.1;

    return waterObj;
  }, [waterGeometry]);

  useFrame((_, delta) => {
    if (water.material.uniforms['time']) {
      water.material.uniforms['time'].value += delta * 0.5;
    }
  });

  return <primitive object={water} />;
}

function InstancedTerrain({ 
  centerX, 
  centerY, 
  viewRange = 50,
  terrainGenerator 
}: { 
  centerX: number; 
  centerY: number; 
  viewRange?: number;
  terrainGenerator: TerrainGenerator;
}) {
  const meshRefs = useRef<Map<TerrainType, THREE.InstancedMesh>>(new Map());
  const [terrainMeshes, setTerrainMeshes] = useState<JSX.Element[]>([]);

  const materials = useMemo(() => ({
    grass: new THREE.MeshStandardMaterial({ 
      color: new THREE.Color(TERRAIN_COLORS.grass.r / 255, TERRAIN_COLORS.grass.g / 255, TERRAIN_COLORS.grass.b / 255),
      roughness: 0.9,
      metalness: 0.0,
    }),
    dirt: new THREE.MeshStandardMaterial({ 
      color: new THREE.Color(TERRAIN_COLORS.dirt.r / 255, TERRAIN_COLORS.dirt.g / 255, TERRAIN_COLORS.dirt.b / 255),
      roughness: 0.95,
      metalness: 0.0,
    }),
    sand: new THREE.MeshStandardMaterial({ 
      color: new THREE.Color(TERRAIN_COLORS.sand.r / 255, TERRAIN_COLORS.sand.g / 255, TERRAIN_COLORS.sand.b / 255),
      roughness: 0.85,
      metalness: 0.0,
    }),
    stone: new THREE.MeshStandardMaterial({ 
      color: new THREE.Color(TERRAIN_COLORS.stone.r / 255, TERRAIN_COLORS.stone.g / 255, TERRAIN_COLORS.stone.b / 255),
      roughness: 0.7,
      metalness: 0.1,
    }),
    water: new THREE.MeshStandardMaterial({ 
      color: new THREE.Color(0.1, 0.3, 0.5),
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.0,
    }),
  }), []);

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 0.2, 1), []);

  useEffect(() => {
    const tilesByType: Record<TerrainType, Array<{ x: number; y: number; height: number }>> = {
      grass: [],
      dirt: [],
      sand: [],
      stone: [],
      water: [],
    };

    const startX = Math.floor(centerX - viewRange);
    const startY = Math.floor(centerY - viewRange);
    const endX = Math.ceil(centerX + viewRange);
    const endY = Math.ceil(centerY + viewRange);

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const terrain = terrainGenerator.getTerrain(x, y);
        const height = TERRAIN_HEIGHTS[terrain.type];
        tilesByType[terrain.type].push({ x, y, height });
      }
    }

    const dummy = new THREE.Object3D();
    const meshElements: JSX.Element[] = [];

    (Object.keys(tilesByType) as TerrainType[]).forEach((type) => {
      const tiles = tilesByType[type];
      if (tiles.length === 0 || type === 'water') return;

      const mesh = new THREE.InstancedMesh(geometry, materials[type], tiles.length);
      mesh.receiveShadow = true;
      mesh.castShadow = false;

      tiles.forEach((tile, i) => {
        dummy.position.set(tile.x, tile.height - 0.1, -tile.y);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });

      mesh.instanceMatrix.needsUpdate = true;
      meshRefs.current.set(type, mesh);
      meshElements.push(<primitive key={type} object={mesh} />);
    });

    setTerrainMeshes(meshElements);

    return () => {
      meshRefs.current.forEach(mesh => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      meshRefs.current.clear();
    };
  }, [centerX, centerY, viewRange, terrainGenerator, geometry, materials]);

  return <group>{terrainMeshes}</group>;
}

function LoadingPlaceholder({ color = '#6366f1' }: { color?: string }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 2;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0.5, 0]}>
      <octahedronGeometry args={[0.3, 0]} />
      <meshStandardMaterial color={color} wireframe />
    </mesh>
  );
}

function EntityLabel({ 
  name, 
  online, 
  type 
}: { 
  name: string; 
  online?: boolean; 
  type: string;
}) {
  const isPlayer = type === 'player';
  
  return (
    <Html
      position={[0, 2.5, 0]}
      center
      style={{
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div style={{
        background: 'rgba(0, 0, 0, 0.75)',
        color: '#fff',
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        {isPlayer && (
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: online ? '#4ade80' : '#6b7280',
            boxShadow: online ? '0 0 6px #4ade80' : 'none',
          }} />
        )}
        {name}
      </div>
    </Html>
  );
}

function EntityModel({
  position,
  name,
  direction,
  modelUrl,
  color = '#6366f1',
  type,
  online,
  entity,
}: {
  position: [number, number, number];
  name?: string;
  direction?: string;
  modelUrl?: string;
  color?: string;
  type: string;
  online?: boolean;
  entity: Entity;
}) {
  const { model, loading } = useModel(modelUrl);
  const { setFocusedEntity, focusedEntity } = useFocus();
  const rotation = directionToRotation(direction);
  const groupRef = useRef<THREE.Group>(null);
  const [targetPos] = useState(() => new THREE.Vector3(...position));
  const [currentPos] = useState(() => new THREE.Vector3(...position));
  const isFocused = focusedEntity?.id === entity.id;

  useEffect(() => {
    targetPos.set(...position);
  }, [position, targetPos]);

  useFrame((_, delta) => {
    currentPos.lerp(targetPos, Math.min(1, delta * 8));
    if (groupRef.current) {
      groupRef.current.position.copy(currentPos);
    }
  });

  const yOffset = useMemo(() => {
    if (!model) return 0;
    const box = new THREE.Box3().setFromObject(model);
    return -box.min.y;
  }, [model]);

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setFocusedEntity(isFocused ? null : entity);
  };

  return (
    <group ref={groupRef} rotation={[0, rotation, 0]} onClick={handleClick}>
      {loading ? (
        <LoadingPlaceholder color={color} />
      ) : model ? (
        <group position={[0, yOffset, 0]}>
          <primitive object={model} />
        </group>
      ) : null}
      {isFocused && (
        <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.8, 1, 32]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.6} />
        </mesh>
      )}
      {name && <EntityLabel name={name} online={online} type={type} />}
    </group>
  );
}

function BuildingMesh({
  position,
  name,
  modelUrl,
  entity,
}: {
  position: [number, number, number];
  name?: string;
  modelUrl?: string;
  entity: Entity;
}) {
  const { model, loading } = useModel(modelUrl);
  const { setFocusedEntity, focusedEntity } = useFocus();
  const isFocused = focusedEntity?.id === entity.id;

  const fallbackHeight = useMemo(() => {
    return 1 + Math.abs(Math.sin(position[0] * 0.1 + position[2] * 0.1)) * 2;
  }, [position]);

  const yOffset = useMemo(() => {
    if (!model) return 0;
    const box = new THREE.Box3().setFromObject(model);
    return -box.min.y;
  }, [model]);

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setFocusedEntity(isFocused ? null : entity);
  };

  const focusRing = isFocused && (
    <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.5, 2, 32]} />
      <meshBasicMaterial color="#8b5cf6" transparent opacity={0.6} />
    </mesh>
  );

  if (model && !loading) {
    return (
      <group position={position} onClick={handleClick}>
        <group position={[0, yOffset, 0]}>
          <primitive object={model} />
        </group>
        {focusRing}
        {name && <EntityLabel name={name} type="building" />}
      </group>
    );
  }

  return (
    <group position={position} onClick={handleClick}>
      <mesh position={[0, fallbackHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[1, fallbackHeight, 1]} />
        <meshStandardMaterial color="#4a4a6a" roughness={0.7} />
      </mesh>
      {focusRing}
      {name && <EntityLabel name={name} type="building" />}
    </group>
  );
}

function getModelUrl(type: string, id: string): string {
  const typeFolder = type === 'auton' ? 'npcs' : type + 's';
  return `/models/${typeFolder}/${id}.glb`;
}

function Entities() {
  const { entities } = useWorld();

  return (
    <group>
      {entities.map((entity) => {
        if (entity.type === 'road') return null;
        
        const pos = worldTo3D(entity.x, entity.y);
        const modelUrl = entity.modelUrl || getModelUrl(entity.type, entity.id);
        const uniqueKey = `${entity.type}-${entity.id}`;

        switch (entity.type) {
          case 'player':
            return (
              <EntityModel
                key={uniqueKey}
                position={pos}
                name={entity.name}
                direction={entity.direction}
                modelUrl={modelUrl}
                color="#6366f1"
                type="player"
                online={entity.online}
                entity={entity}
              />
            );
          case 'npc':
          case 'auton':
            return (
              <EntityModel
                key={uniqueKey}
                position={pos}
                name={entity.name}
                direction={entity.direction}
                modelUrl={modelUrl}
                color="#22c55e"
                type="npc"
                entity={entity}
              />
            );
          case 'building':
            return (
              <BuildingMesh
                key={uniqueKey}
                position={pos}
                name={entity.name}
                modelUrl={modelUrl}
                entity={entity}
              />
            );
          default:
            return null;
        }
      })}
    </group>
  );
}

function Lighting() {
  const sunPosition: [number, number, number] = [100, 80, 50];
  
  return (
    <>
      <ambientLight intensity={0.3} color="#87ceeb" />
      <hemisphereLight
        color="#87ceeb"
        groundColor="#8b7355"
        intensity={0.4}
      />
      <directionalLight
        position={sunPosition}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-far={300}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-bias={-0.0001}
      />
    </>
  );
}

function PostProcessingEffects() {
  return (
    <EffectComposer>
      <SSAO 
        radius={0.4}
        intensity={30}
        luminanceInfluence={0.5}
        color={new THREE.Color(0, 0, 0)}
        worldDistanceThreshold={100}
        worldDistanceFalloff={10}
        worldProximityThreshold={1}
        worldProximityFalloff={0.1}
      />
      <Bloom 
        luminanceThreshold={0.8}
        luminanceSmoothing={0.3}
        intensity={0.3}
      />
    </EffectComposer>
  );
}

function KeyboardControls() {
  const { camera } = useThree();
  const keys = useRef<Set<string>>(new Set());
  const moveSpeed = 0.5;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keys.current.add(e.key.toLowerCase());
    const handleKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame(() => {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(direction, new THREE.Vector3(0, 1, 0));

    if (keys.current.has('arrowup') || keys.current.has('w')) {
      camera.position.addScaledVector(direction, moveSpeed);
    }
    if (keys.current.has('arrowdown') || keys.current.has('s')) {
      camera.position.addScaledVector(direction, -moveSpeed);
    }
    if (keys.current.has('arrowleft') || keys.current.has('a')) {
      camera.position.addScaledVector(right, -moveSpeed);
    }
    if (keys.current.has('arrowright') || keys.current.has('d')) {
      camera.position.addScaledVector(right, moveSpeed);
    }
    if (keys.current.has('q')) {
      camera.position.y += moveSpeed;
    }
    if (keys.current.has('e')) {
      camera.position.y -= moveSpeed;
    }
  });

  return null;
}

function Scene() {
  const { entities, worldData } = useWorld();
  const { focusedEntity } = useFocus();
  const controlsRef = useRef<THREE.EventDispatcher & { target: THREE.Vector3 }>(null);

  const terrainGenerator = useMemo(() => {
    const seed = worldData?.seed || '12345';
    return new TerrainGenerator(seed);
  }, [worldData?.seed]);

  const defaultTarget = useMemo(() => {
    const players = entities.filter(e => e.type === 'player');
    if (players.length === 0) return [0, 0, 0] as [number, number, number];

    const avgX = players.reduce((sum, p) => sum + p.x, 0) / players.length;
    const avgY = players.reduce((sum, p) => sum + p.y, 0) / players.length;
    return worldTo3D(avgX, avgY);
  }, [entities]);

  const cameraTarget = useMemo(() => {
    if (focusedEntity) {
      return worldTo3D(focusedEntity.x, focusedEntity.y);
    }
    return defaultTarget;
  }, [focusedEntity, defaultTarget]);

  useEffect(() => {
    if (controlsRef.current && focusedEntity) {
      const target = worldTo3D(focusedEntity.x, focusedEntity.y);
      controlsRef.current.target.set(target[0], target[1], target[2]);
    }
  }, [focusedEntity]);

  return (
    <>
      <color attach="background" args={['#87ceeb']} />
      <fog attach="fog" args={['#c9deff', 80, 250]} />

      <Sky
        distance={450000}
        sunPosition={[100, 80, 50]}
        inclination={0.5}
        azimuth={0.25}
        turbidity={8}
        rayleigh={0.5}
      />

      <Lighting />

      <InstancedTerrain
        centerX={cameraTarget[0]}
        centerY={-cameraTarget[2]}
        viewRange={50}
        terrainGenerator={terrainGenerator}
      />

      <ReflectiveWater />

      <Entities />

      <OrbitControls
        ref={controlsRef as React.RefObject<never>}
        target={cameraTarget}
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={200}
        maxPolarAngle={Math.PI / 2 - 0.1}
        enablePan
        panSpeed={1.5}
        screenSpacePanning={false}
      />

      <KeyboardControls />
      <PostProcessingEffects />
    </>
  );
}

function StatsOverlay() {
  const { entities } = useWorld();
  
  const stats = useMemo(() => {
    const players = entities.filter(e => e.type === 'player');
    const npcs = entities.filter(e => e.type === 'auton' || e.type === 'npc');
    const buildings = entities.filter(e => e.type === 'building');
    const onlinePlayers = players.filter(p => p.online);
    
    return { 
      total: entities.length,
      players: players.length,
      online: onlinePlayers.length,
      npcs: npcs.length,
      buildings: buildings.length,
    };
  }, [entities]);

  return (
    <div className="stats-overlay">
      <div className="stat-item">
        <span className="stat-label">Players</span>
        <span className="stat-value">{stats.online}/{stats.players}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">NPCs</span>
        <span className="stat-value">{stats.npcs}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Buildings</span>
        <span className="stat-value">{stats.buildings}</span>
      </div>
    </div>
  );
}

function Minimap() {
  const { entities } = useWorld();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 160;
  const scale = 1.5;

  const center = useMemo(() => {
    const players = entities.filter(e => e.type === 'player');
    if (players.length === 0) return { x: 0, y: 0 };
    return {
      x: players.reduce((sum, p) => sum + p.x, 0) / players.length,
      y: players.reduce((sum, p) => sum + p.y, 0) / players.length,
    };
  }, [entities]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    const gridSize = 20;
    for (let i = 0; i <= size; i += gridSize) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }

    const half = size / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(half - 6, half);
    ctx.lineTo(half + 6, half);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(half, half - 6);
    ctx.lineTo(half, half + 6);
    ctx.stroke();

    entities.forEach(entity => {
      if (entity.type === 'road') return;
      
      const screenX = half + (entity.x - center.x) * scale;
      const screenY = half + (entity.y - center.y) * scale;
      
      if (screenX < 0 || screenX > size || screenY < 0 || screenY > size) return;

      switch (entity.type) {
        case 'player':
          ctx.fillStyle = entity.online ? '#4ade80' : '#6b7280';
          ctx.beginPath();
          ctx.arc(screenX, screenY, 4, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'npc':
        case 'auton':
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(screenX, screenY, 3, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'building':
          ctx.fillStyle = '#8b5cf6';
          ctx.fillRect(screenX - 3, screenY - 3, 6, 6);
          break;
      }
    });

  }, [entities, center]);

  return (
    <div className="minimap-container">
      <canvas ref={canvasRef} width={size} height={size} className="minimap-canvas" />
    </div>
  );
}

export function World3D() {
  const { entities } = useWorld();
  const [focusedEntity, setFocusedEntity] = useState<Entity | null>(null);

  const focusTarget = useMemo(() => {
    if (!focusedEntity) return null;
    return new THREE.Vector3(...worldTo3D(focusedEntity.x, focusedEntity.y));
  }, [focusedEntity]);

  const focusContextValue = useMemo(() => ({
    focusedEntity,
    setFocusedEntity,
    focusTarget,
  }), [focusedEntity, focusTarget]);

  const initialCameraPosition = useMemo(() => {
    const players = entities.filter(e => e.type === 'player');
    if (players.length === 0) return [20, 15, 20] as [number, number, number];

    const avgX = players.reduce((sum, p) => sum + p.x, 0) / players.length;
    const avgY = players.reduce((sum, p) => sum + p.y, 0) / players.length;
    return [avgX + 20, 15, -avgY + 20] as [number, number, number];
  }, []);

  return (
    <FocusContext.Provider value={focusContextValue}>
      <Canvas
        shadows="soft"
        camera={{
          position: initialCameraPosition,
          fov: 60,
          near: 0.1,
          far: 2000,
        }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>

      <StatsOverlay />
      <Minimap />
      
      {focusedEntity && (
        <div className="focus-indicator">
          <span>Focused: {focusedEntity.name || focusedEntity.id}</span>
          <button onClick={() => setFocusedEntity(null)}>Clear</button>
        </div>
      )}
    </FocusContext.Provider>
  );
}
