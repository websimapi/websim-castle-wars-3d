import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const room = new WebsimSocket();
let camera, scene, renderer, controls;
let playerMeshes = {};
let castles = {};

const TEAMS = {
    RED: 'red',
    BLUE: 'blue'
};

const CASTLE_CONFIG = {
    width: 100,
    height: 60,
    depth: 100,
    floors: 3,
    wallThickness: 5
};

const gameState = {
    players: {},
    scores: {
        [TEAMS.RED]: 0,
        [TEAMS.BLUE]: 0
    }
};

async function init() {
    await room.initialize();

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    // Camera setup
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 0);

    // Renderer setup
    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Controls
    controls = new PointerLockControls(camera, document.body);
    
    document.addEventListener('click', () => {
        controls.lock();
    });

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(100, 100, 100);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Ground
    const groundGeometry = new THREE.PlaneGeometry(500, 500);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x2d5a27,
        roughness: 0.8
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Create castles
    createCastle(TEAMS.RED, new THREE.Vector3(-150, 0, 0));
    createCastle(TEAMS.BLUE, new THREE.Vector3(150, 0, 0));

    // Initialize player
    const myTeam = Math.random() < 0.5 ? TEAMS.RED : TEAMS.BLUE;
    const spawnPoint = getTeamSpawnPoint(myTeam);
    
    room.updatePresence({
        position: { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z },
        rotation: 0,
        team: myTeam,
        health: 100
    });

    // Subscribe to presence updates
    room.subscribePresence((presence) => {
        updatePlayers(presence);
    });

    // Handle presence update requests (damage, etc)
    room.subscribePresenceUpdateRequests((request, fromClientId) => {
        if (request.type === 'damage') {
            const currentHealth = room.presence[room.clientId].health;
            const newHealth = Math.max(0, currentHealth - request.amount);
            
            room.updatePresence({
                health: newHealth
            });

            updateHealthBar(newHealth);

            if (newHealth <= 0) {
                handlePlayerDeath();
            }
        }
    });

    // Movement controls
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    animate();
}

function createCastle(team, position) {
    const castle = new THREE.Group();
    const color = team === TEAMS.RED ? 0xcc0000 : 0x0000cc;
    
    // Main structure
    for (let floor = 0; floor < CASTLE_CONFIG.floors; floor++) {
        const floorHeight = CASTLE_CONFIG.height / CASTLE_CONFIG.floors;
        const floorY = floor * floorHeight;
        
        // Floor
        const floorGeom = new THREE.BoxGeometry(
            CASTLE_CONFIG.width,
            CASTLE_CONFIG.wallThickness,
            CASTLE_CONFIG.depth
        );
        const floorMesh = new THREE.Mesh(
            floorGeom,
            new THREE.MeshStandardMaterial({ color: color })
        );
        floorMesh.position.set(0, floorY, 0);
        castle.add(floorMesh);

        // Walls
        if (floor < CASTLE_CONFIG.floors - 1) {
            const wallGeom = new THREE.BoxGeometry(
                CASTLE_CONFIG.width,
                floorHeight,
                CASTLE_CONFIG.wallThickness
            );
            
            // Front wall
            const frontWall = new THREE.Mesh(
                wallGeom,
                new THREE.MeshStandardMaterial({ color: color })
            );
            frontWall.position.set(0, floorY + floorHeight/2, CASTLE_CONFIG.depth/2);
            castle.add(frontWall);

            // Back wall
            const backWall = frontWall.clone();
            backWall.position.z = -CASTLE_CONFIG.depth/2;
            castle.add(backWall);

            // Side walls
            const sideWallGeom = new THREE.BoxGeometry(
                CASTLE_CONFIG.wallThickness,
                floorHeight,
                CASTLE_CONFIG.depth
            );
            
            const leftWall = new THREE.Mesh(
                sideWallGeom,
                new THREE.MeshStandardMaterial({ color: color })
            );
            leftWall.position.set(-CASTLE_CONFIG.width/2, floorY + floorHeight/2, 0);
            castle.add(leftWall);

            const rightWall = leftWall.clone();
            rightWall.position.x = CASTLE_CONFIG.width/2;
            castle.add(rightWall);
        }
    }

    // Add towers at corners
    const towerRadius = CASTLE_CONFIG.wallThickness * 1.5;
    const towerHeight = CASTLE_CONFIG.height * 1.2;
    const towerGeom = new THREE.CylinderGeometry(towerRadius, towerRadius, towerHeight, 8);
    
    const corners = [
        [-CASTLE_CONFIG.width/2, -CASTLE_CONFIG.depth/2],
        [-CASTLE_CONFIG.width/2, CASTLE_CONFIG.depth/2],
        [CASTLE_CONFIG.width/2, -CASTLE_CONFIG.depth/2],
        [CASTLE_CONFIG.width/2, CASTLE_CONFIG.depth/2]
    ];

    corners.forEach(([x, z]) => {
        const tower = new THREE.Mesh(
            towerGeom,
            new THREE.MeshStandardMaterial({ color: color })
        );
        tower.position.set(x, towerHeight/2, z);
        castle.add(tower);
    });

    castle.position.copy(position);
    scene.add(castle);
    castles[team] = castle;
}

function getTeamSpawnPoint(team) {
    const castle = castles[team];
    if (!castle) return new THREE.Vector3();
    
    const spawnOffset = new THREE.Vector3(
        (Math.random() - 0.5) * 20,
        10,
        (Math.random() - 0.5) * 20
    );
    
    return castle.position.clone().add(spawnOffset);
}

function handlePlayerDeath() {
    const myTeam = room.presence[room.clientId].team;
    const spawnPoint = getTeamSpawnPoint(myTeam);
    
    room.updatePresence({
        position: { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z },
        health: 100
    });

    camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
}

function updateHealthBar(health) {
    const healthFill = document.getElementById('health-fill');
    healthFill.style.width = `${health}%`;
    healthFill.style.backgroundColor = health > 50 ? '#00ff00' : health > 25 ? '#ffff00' : '#ff0000';
}

function updatePlayers(presence) {
    // Update or create player meshes
    Object.entries(presence).forEach(([clientId, data]) => {
        if (!playerMeshes[clientId]) {
            const geometry = new THREE.BoxGeometry(2, 4, 2);
            const material = new THREE.MeshStandardMaterial({
                color: data.team === TEAMS.RED ? 0xff0000 : 0x0000ff
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            scene.add(mesh);
            playerMeshes[clientId] = mesh;
        }

        const mesh = playerMeshes[clientId];
        if (data.position) {
            mesh.position.set(data.position.x, data.position.y, data.position.z);
        }
        if (data.rotation !== undefined) {
            mesh.rotation.y = data.rotation;
        }
    });

    // Remove disconnected players
    Object.keys(playerMeshes).forEach(clientId => {
        if (!presence[clientId]) {
            scene.remove(playerMeshes[clientId]);
            delete playerMeshes[clientId];
        }
    });
}

const keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false
};

function handleKeyDown(event) {
    switch(event.code) {
        case 'KeyW': keys.forward = true; break;
        case 'KeyS': keys.backward = true; break;
        case 'KeyA': keys.left = true; break;
        case 'KeyD': keys.right = true; break;
        case 'Space': keys.jump = true; break;
    }
}

function handleKeyUp(event) {
    switch(event.code) {
        case 'KeyW': keys.forward = false; break;
        case 'KeyS': keys.backward = false; break;
        case 'KeyA': keys.left = false; break;
        case 'KeyD': keys.right = false; break;
        case 'Space': keys.jump = false; break;
    }
}

function movePlayer() {
    if (!controls.isLocked) return;

    const speed = 0.5;
    const direction = new THREE.Vector3();
    const rotation = camera.rotation.y;

    if (keys.forward) {
        direction.z -= Math.cos(rotation) * speed;
        direction.x -= Math.sin(rotation) * speed;
    }
    if (keys.backward) {
        direction.z += Math.cos(rotation) * speed;
        direction.x += Math.sin(rotation) * speed;
    }
    if (keys.left) {
        direction.x -= Math.cos(rotation) * speed;
        direction.z += Math.sin(rotation) * speed;
    }
    if (keys.right) {
        direction.x += Math.cos(rotation) * speed;
        direction.z -= Math.sin(rotation) * speed;
    }

    camera.position.add(direction);

    room.updatePresence({
        position: {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z
        },
        rotation: camera.rotation.y
    });
}

function animate() {
    requestAnimationFrame(animate);
    movePlayer();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();

