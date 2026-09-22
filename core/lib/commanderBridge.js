const fs = require('fs');
const path = require('path');
const http = require('http');

class CommanderBridge {
  constructor(port = 28550) {
    this.port = port;
    this.online = false;
    this.bufferFile = path.join(__dirname, '../data/rl_experience_buffer.jsonl');
    this.initBuffer();
  }

  initBuffer() {
    const dir = path.dirname(this.bufferFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  async decide(sitString) {
    return new Promise((resolve) => {
      const payload = JSON.stringify({ sit: sitString });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: '/decide',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 2500 // 2.5s timeout for inference
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              this.online = true;
              resolve({
                thk: parsed.thk || '',
                act: parsed.act || '',
                raw: parsed.raw || ''
              });
            } catch (err) {
              resolve(null);
            }
          });
        }
      );

      req.on('error', () => {
        this.online = false;
        resolve(null);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(payload);
      req.end();
    });
  }

  // Hoc tang cuong truc tiep: Ghi nhan vet kinh nghiem (Experience Trace) kem Reward
  recordExperience(sit, thk, act, reward, feedbackReason) {
    const record = {
      timestamp: Date.now(),
      sit,
      thk,
      act,
      reward,
      feedback: feedbackReason
    };

    try {
      fs.appendFileSync(this.bufferFile, JSON.stringify(record) + '\n', 'utf8');
      if (reward <= -500 || reward >= 300) {
        this.archiveCriticalLesson(record);
      }
    } catch (e) {}
  }

  archiveCriticalLesson(record) {
    const criticalPath = path.join(__dirname, '../data/rl_critical_lessons.jsonl');
    try {
      fs.appendFileSync(criticalPath, JSON.stringify(record) + '\n', 'utf8');
    } catch (e) {}
  }
}

module.exports = CommanderBridge;
