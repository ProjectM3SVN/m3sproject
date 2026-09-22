/**
 * deltaBuffer.js - Spatial Ring Buffer for Real-Time Voxel/Entity Deltas
 * Maintains the latest N world modifications in memory without leaking RAM.
 * Memory overhead < 20MB.
 */
class DeltaRingBuffer {
  constructor(capacity = 5000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.count = 0;
    this.sequence = 0;
  }

  push(event) {
    this.sequence++;
    const delta = {
      seq: this.sequence,
      timestamp: Date.now(),
      ...event
    };

    this.buffer[this.head] = delta;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
    return delta;
  }

  getSince(seq = 0, limit = 500) {
    if (this.count === 0) return [];
    const results = [];
    let checked = 0;
    let idx = (this.head - 1 + this.capacity) % this.capacity;

    while (checked < this.count && results.length < limit) {
      const item = this.buffer[idx];
      if (!item || item.seq <= seq) break;
      results.push(item);
      idx = (idx - 1 + this.capacity) % this.capacity;
      checked++;
    }

    return results.reverse();
  }

  getSnapshot() {
    return this.getSince(0, this.count);
  }
}

module.exports = DeltaRingBuffer;
