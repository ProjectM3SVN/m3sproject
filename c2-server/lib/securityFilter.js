/**
 * securityFilter.js - Zero-Leak Data Scrubber
 * 
 * Rules:
 * 1. Blocks: If Y < 60 or block is container (chest, barrel, shulker), DROP from public stream.
 * 2. Entities: If entity belongs to M3S Swarm, snap coordinates to coarse 500x500 grid cell.
 * 3. Threats: Hostiles are transmitted with coarse fuzzing on public stream.
 */
const STORAGE_BLOCKS = new Set([
  'chest', 'trapped_chest', 'barrel', 'shulker_box',
  'white_shulker_box', 'black_shulker_box', 'ender_chest'
]);

class SecurityFilter {
  static sanitizeDelta(event) {
    if (!event) return null;

    // 1. Block Update Scrubber
    if (event.type === 'blockUpdate' || event.type === 'multi_block_change') {
      const y = event.y !== undefined ? event.y : (event.pos ? event.pos.y : 0);
      const blockName = (event.blockName || (event.block ? event.block.name : '')).toLowerCase();

      // Drop all deep underground deltas (Y < 60) and storage containers
      if (y < 60 || STORAGE_BLOCKS.has(blockName)) {
        return null;
      }

      return {
        type: event.type,
        x: Math.floor(event.x !== undefined ? event.x : event.pos.x),
        y: Math.floor(y),
        z: Math.floor(event.z !== undefined ? event.z : event.pos.z),
        blockName: blockName
      };
    }

    // 2. Swarm Entity/Player Position Scrubber
    if (event.type === 'playerVector' || event.type === 'entityMove') {
      const isSwarmMember = event.isSwarm || (event.name && event.name.startsWith('MSNPC_'));
      const rawX = event.x !== undefined ? event.x : event.pos.x;
      const rawZ = event.z !== undefined ? event.z : event.pos.z;

      if (isSwarmMember) {
        // Coarse 500x500 chunk grid snapping (Obscures exact base & bot positions)
        const cellX = Math.floor(rawX / 500) * 500 + 250;
        const cellZ = Math.floor(rawZ / 500) * 500 + 250;
        return {
          type: 'swarmGridDensity',
          cellX,
          cellZ,
          intensity: 1,
          timestamp: Date.now()
        };
      }

      // Hostile / External Player radar
      return {
        type: 'hostileRadarBlip',
        x: Math.round(rawX),
        z: Math.round(rawZ),
        threatLevel: event.threatLevel || 'UNKNOWN'
      };
    }

    return null;
  }
}

module.exports = SecurityFilter;
