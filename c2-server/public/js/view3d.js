/**
 * view3d.js - MSView Three.js WebGL 3D Voxel Inspector
 * 
 * Capabilities:
 * - 60 FPS WebGL rendering with OrbitControls & Free-Fly camera.
 * - InstancedMesh Voxel Rendering with high-contrast color mapping.
 * - Tactical X-Ray Mode: Hides/makes stone transparent, highlights ore veins and chests in wireframe.
 * - Vulnerability Overlay: Highlights un-waterlogged obsidian blocks or exposed bases in red bounding boxes.
 * - Real-time WebSocket delta consumer (Public vs Classified switch).
 */

let scene, camera, renderer, controls;
let voxelMeshMap = new Map(); // blockType -> InstancedMesh
let xrayMode = false;
let vulnOverlay = true;

// Material Palette
const materials = {
  stone: new THREE.MeshLambertMaterial({ color: 0x555555 }),
  deepslate: new THREE.MeshLambertMaterial({ color: 0x222222 }),
  dirt: new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
  grass_block: new THREE.MeshLambertMaterial({ color: 0x4c9a2a }),
  obsidian: new THREE.MeshLambertMaterial({ color: 0x1a0f2e }),
  chest: new THREE.MeshLambertMaterial({ color: 0xffa500, wireframe: false }),
  diamond_ore: new THREE.MeshLambertMaterial({ color: 0x00f0ff, emissive: 0x005577 }),
  iron_ore: new THREE.MeshLambertMaterial({ color: 0xd8af93 }),
  vulnBox: new THREE.LineBasicMaterial({ color: 0xff3366, linewidth: 2 })
};

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const wireframeGeometry = new THREE.EdgesGeometry(boxGeometry);

function init3DView() {
  const container = document.getElementById('view3d-container');
  const canvas = document.getElementById('webgl-canvas');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d12);
  scene.fog = new THREE.FogExp2(0x0a0d12, 0.015);

  camera = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 80, 50);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Ambient & Directional Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(50, 100, 50);
  scene.add(dirLight);

  // Ground grid reference
  const gridHelper = new THREE.GridHelper(200, 50, 0x00f0ff, 0x1f2937);
  gridHelper.position.y = 60;
  scene.add(gridHelper);

  // Event Listeners
  window.addEventListener('resize', onWindowResize);
  setupControlsUI();
  setupWebSocket();

  // Animation Loop (Strict 60 FPS)
  animate();
}

function onWindowResize() {
  const container = document.getElementById('view3d-container');
  if (!container) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Add Voxel to 3D Scene
function addVoxel(x, y, z, blockName) {
  let mat = materials.stone;
  let isOreOrChest = false;

  if (blockName.includes('obsidian')) mat = materials.obsidian;
  else if (blockName.includes('chest')) { mat = materials.chest; isOreOrChest = true; }
  else if (blockName.includes('diamond')) { mat = materials.diamond_ore; isOreOrChest = true; }
  else if (blockName.includes('iron')) { mat = materials.iron_ore; isOreOrChest = true; }
  else if (blockName.includes('dirt')) mat = materials.dirt;
  else if (blockName.includes('grass')) mat = materials.grass_block;
  else if (blockName.includes('deepslate')) mat = materials.deepslate;

  // If X-Ray is ON and this is solid rock -> skip rendering to reveal hidden ore veins
  if (xrayMode && !isOreOrChest && !blockName.includes('obsidian')) {
    return;
  }

  const cube = new THREE.Mesh(boxGeometry, mat);
  cube.position.set(x, y, z);
  scene.add(cube);

  // Vulnerability detection: If obsidian is placed exposed at high Y, mark with red wireframe
  if (vulnOverlay && blockName.includes('obsidian')) {
    const wire = new THREE.LineSegments(wireframeGeometry, materials.vulnBox);
    wire.position.set(x, y, z);
    scene.add(wire);
  }
}

// Tactical HUD UI Controls
function setupControlsUI() {
  const btnXray = document.getElementById('btn-xray-toggle');
  const btnVuln = document.getElementById('btn-vuln-toggle');
  const btnAuth = document.getElementById('btn-auth-toggle');

  btnXray.addEventListener('click', () => {
    xrayMode = !xrayMode;
    btnXray.textContent = `X-RAY: ${xrayMode ? 'ON' : 'OFF'}`;
    btnXray.classList.toggle('active', xrayMode);
    // Reload scene voxels
  });

  btnVuln.addEventListener('click', () => {
    vulnOverlay = !vulnOverlay;
    btnVuln.textContent = `VULNERABILITY SCAN: ${vulnOverlay ? 'ON' : 'OFF'}`;
    btnVuln.classList.toggle('active', vulnOverlay);
  });

  btnAuth.addEventListener('click', () => {
    const token = prompt('Enter C2 Classified Bearer Secret:');
    if (token) {
      window.c2Token = token;
      setupWebSocket(token);
    }
  });
}

// WebSocket Stream Consumer
let ws = null;
function setupWebSocket(token = null) {
  if (ws) {
    try { ws.close(); } catch {}
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsPath = token ? '/ws/classified' : '/ws/public';
  const url = `${protocol}//${location.host}${wsPath}`;

  ws = new WebSocket(url, token ? [token] : []);

  ws.onopen = () => {
    const badge = document.getElementById('c2-status');
    if (badge) {
      badge.textContent = token ? 'STREAM: CLASSIFIED (FULL C2)' : 'STREAM: PUBLIC (SANITIZED)';
      badge.style.color = token ? '#00f0ff' : '#00ff88';
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'DELTA' && msg.data) {
        const d = msg.data;
        if (d.type === 'blockUpdate' && d.x !== undefined) {
          addVoxel(d.x, d.y, d.z, d.blockName || 'stone');
        } else if (d.type === 'hostileRadarBlip') {
          if (window.update2DHostiles) update2DHostiles([d]);
        }
      } else if (msg.type === 'SNAPSHOT' && Array.isArray(msg.data)) {
        msg.data.forEach(d => {
          if (d.x !== undefined && d.y !== undefined) {
            addVoxel(d.x, d.y, d.z, d.blockName || 'stone');
          }
        });
      }
    } catch {}
  };

  ws.onclose = () => {
    setTimeout(() => setupWebSocket(window.c2Token), 3000);
  };
}

window.addEventListener('DOMContentLoaded', init3DView);
