export class Character {
  constructor({ id, factionId, name, respawnDelay = 3 }) {
    this.id = id;
    this.factionId = factionId;
    this.name = name;
    this.respawnDelay = respawnDelay;

    this.alive = true;
    this.isHuman = false;
    this.pos = { x: 0, z: 0 };
    this.dir = { x: 0, z: 1 };
    this.targetDir = { x: 0, z: 1 };
    this.speed = 6;
    this.trailVerts = [];
    this.invulnTimer = 0;
    this.respawnTimer = 0;
    this.killCount = 0;
  }

  setPos(x, z) {
    this.pos = { x, z };
  }

  setDir(x, z) {
    this.dir = { x, z };
  }

  kill() {
    this.alive = false;
    this.respawnTimer = this.respawnDelay;
    this.trailVerts = [];
    this.invulnTimer = 0;
  }

  respawn(x, z) {
    this.alive = true;
    this.pos = { x, z };
    this.respawnTimer = 0;
    this.invulnTimer = 2;
    this.trailVerts = [];
  }
}
