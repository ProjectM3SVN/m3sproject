/**
 * map2d.js - Leaflet Tactical Map Engine
 * - Renders 2D surface radar, hostile blips, and coarse swarm grid.
 * - Handles double-click tactical ping dispatching Scout orders.
 */
let map;
let hostileMarkers = [];
let swarmGridLayers = [];

function initMap2D() {
  // Center at spawn (0, 0)
  map = L.map('leaflet-map', {
    crs: L.CRS.Simple,
    minZoom: -3,
    maxZoom: 2,
    zoomControl: false,
    attributionControl: false
  }).setView([0, 0], -1);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Grid background
  const gridBounds = [[-2000, -2000], [2000, 2000]];
  L.rectangle(gridBounds, { color: "#1f2937", weight: 1, fill: false }).addTo(map);

  // Spawn Marker (0,0)
  L.circleMarker([0, 0], {
    radius: 6,
    color: '#ffb800',
    fillColor: '#ffb800',
    fillOpacity: 0.8
  }).bindTooltip('WORLD SPAWN (0, 0)', { permanent: false }).addTo(map);

  // Tactical Ping on Double Click -> Send Scout to sector
  map.on('dblclick', (e) => {
    const targetX = Math.round(e.latlng.lng);
    const targetZ = Math.round(e.latlng.lat);

    const pingMarker = L.circleMarker([targetZ, targetX], {
      radius: 12,
      color: '#00f0ff',
      dashArray: '4, 4',
      fill: false
    }).addTo(map);

    setTimeout(() => map.removeLayer(pingMarker), 10000);

    // Send dispatch via C2 API
    fetch('/api/c2/command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.c2Token || ''}`
      },
      body: JSON.stringify({
        command: 'SCOUT_SECTOR',
        payload: { x: targetX, z: targetZ }
      })
    }).then(res => res.json()).then(data => {
      console.log('[TACTICAL PING DISPATCHED]', data);
    }).catch(() => {});
  });
}

function update2DHostiles(blips) {
  hostileMarkers.forEach(m => map.removeLayer(m));
  hostileMarkers = [];

  blips.forEach(blip => {
    const marker = L.circleMarker([blip.z, blip.x], {
      radius: 8,
      color: '#ff3366',
      fillColor: '#ff3366',
      fillOpacity: 0.85
    }).bindTooltip(`HOSTILE DETECTED (${blip.x}, ${blip.z})`, { permanent: true });
    marker.addTo(map);
    hostileMarkers.push(marker);
  });

  const countLabel = document.getElementById('hostile-count-label');
  if (countLabel) {
    countLabel.textContent = `HOSTILES: ${blips.length} DETECTED`;
  }
}

window.addEventListener('DOMContentLoaded', initMap2D);
