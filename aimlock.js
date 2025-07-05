// == Vector3 Class ==
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  add(v){return new Vector3(this.x+v.x,this.y+v.y,this.z+v.z);}
  subtract(v){return new Vector3(this.x-v.x,this.y-v.y,this.z-v.z);}
  multiplyScalar(s){return new Vector3(this.x*s,this.y*s,this.z*s);}
  length(){return Math.sqrt(this.x**2+this.y**2+this.z**2);}
  normalize(){const l=this.length();return l>0?this.multiplyScalar(1/l):new Vector3();}
  clone(){return new Vector3(this.x,this.y,this.z);}
  static zero(){return new Vector3(0,0,0);}
}

// == Coordinate Transform ==
function worldToCameraSpace(worldVec, forward, right, up) {
  return new Vector3(
    worldVec.x * right.x + worldVec.y * right.y + worldVec.z * right.z,
    worldVec.x * up.x + worldVec.y * up.y + worldVec.z * up.z,
    worldVec.x * forward.x + worldVec.y * forward.y + worldVec.z * forward.z
  );
}
function cameraToWorldSpace(localVec, forward, right, up) {
  return new Vector3(
    localVec.x * right.x + localVec.y * up.x + localVec.z * forward.x,
    localVec.x * right.y + localVec.y * up.y + localVec.z * forward.y,
    localVec.x * right.z + localVec.y * up.z + localVec.z * forward.z
  );
}

// == Apply Bindpose Matrix to Position Vector3 ==
function applyBindposeTransform(pos, bindpose) {
  const x = pos.x, y = pos.y, z = pos.z;
  return new Vector3(
    bindpose.e00 * x + bindpose.e01 * y + bindpose.e02 * z + bindpose.e03,
    bindpose.e10 * x + bindpose.e11 * y + bindpose.e12 * z + bindpose.e13,
    bindpose.e20 * x + bindpose.e21 * y + bindpose.e22 * z + bindpose.e23
  );
}

// == AimLockEngine Class ==
class AimLockEngine {
  constructor(config) {
    this.config = config;
    this.recoilAccumulated = { x: 0, y: 0 };
    this.smoothedAim = { x: 0, y: 0 };
    this.state = {
      lastVec: new Vector3(),
      kalmanAlpha: 0.75
    };
  }

  smooth(value, prev, alpha=0.3) {
    return alpha * value + (1 - alpha) * prev;
  }

  applyRecoil(weapon) {
    const recoil = this.config.recoil[weapon] || { x: 0, y: 0 };
    this.recoilAccumulated.x += recoil.x;
    this.recoilAccumulated.y += recoil.y;
    this.recoilAccumulated.x *= 0.85;
    this.recoilAccumulated.y *= 0.85;
    return { x: -this.recoilAccumulated.x, y: -this.recoilAccumulated.y };
  }

  dynamicSensitivity(baseSpeed, offsetMagnitude, isFiring) {
    const minSpeed = baseSpeed * 0.5;
    const maxSpeed = baseSpeed * 1.5;
    const scale = Math.min(offsetMagnitude * 2, 1);
    return isFiring ? minSpeed + (maxSpeed - minSpeed) * scale : baseSpeed;
  }

  predictHeadPosition(enemy, deltaTime) {
    // Dự đoán vị trí đầu theo velocity
    return enemy.head.add(enemy.velocity.multiplyScalar(deltaTime));
  }

  applyKalmanFilter(current, last, alpha) {
    return new Vector3(
      alpha * current.x + (1 - alpha) * last.x,
      alpha * current.y + (1 - alpha) * last.y,
      alpha * current.z + (1 - alpha) * last.z
    );
  }

  compensateArmor(head, level=2) {
    return new Vector3(
      head.x,
      head.y + 0.015 * (1 - level * 0.1),
      head.z
    );
  }

  getFinalTarget(localPlayer, enemy, weapon) {
    const deltaTime = 0.016; // approx 60fps
    const predicted = this.predictHeadPosition(enemy, deltaTime);
    const compensated = this.compensateArmor(predicted, enemy.armorLevel);
    const smoothed = new Vector3(
      this.smooth(compensated.x, this.state.lastVec.x, 0.65),
      this.smooth(compensated.y, this.state.lastVec.y, 0.65),
      this.smooth(compensated.z, this.state.lastVec.z, 0.65)
    );
    const filtered = this.applyKalmanFilter(smoothed, this.state.lastVec, this.state.kalmanAlpha);
    this.state.lastVec = filtered;
    return filtered;
  }

  aimToTarget(camera, target, weapon) {
    const dx = target.x - camera.position.x;
    const dy = target.y - camera.position.y;
    const dz = target.z - camera.position.z;

    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if(len === 0) return;

    const norm = { x: dx / len, y: dy / len, z: dz / len };

    const pitch = -Math.asin(norm.y);
    const yaw = Math.atan2(norm.x, norm.z);

    const weaponGain = this.config.weapon_gain[weapon] || this.config.weapon_gain["default"];

    sendInputToMouse({
      deltaX: yaw * weaponGain.yaw,
      deltaY: pitch * weaponGain.pitch
    });
  }

  isInHeadSnapZone(camera, target) {
    const dx = camera.target.x - target.x;
    const dy = camera.target.y - target.y;
    const dz = camera.target.z - target.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return dist < this.config.snap_radius;
  }

  triggerAutoFire() {
    if(!isFiring()) {
      simulateMouseDown();
      setTimeout(() => simulateMouseUp(), 55);
    }
  }

  smartSelect(localPlayer, enemies, fovDeg=60) {
    let best = null;
    let bestScore = Infinity;
    const offset = this.config.bindposeOffset;

    for(const e of enemies){
      if(e.health <= 0) continue;

      const head = new Vector3(e.x + offset.x, e.y + offset.y, e.z + offset.z);
      const dx = head.x - localPlayer.x;
      const dz = head.z - localPlayer.z;
      const yaw = Math.atan2(dx, dz);
      const yawDiff = Math.abs(yaw - localPlayer.cameraYaw);

      if(yawDiff > fovDeg * (Math.PI/180)) continue;

      const dist = Math.sqrt(dx*dx + (head.y - localPlayer.y)**2 + dz*dz);
      const score = dist + yawDiff * 15;

      if(score < bestScore){
        bestScore = score;
        best = { ...e, head };
      }
    }
    return best;
  }

  update(localPlayer, enemies, weapon) {
    const target = this.smartSelect(localPlayer, enemies);
    if(!target) return;

    const finalVec = this.getFinalTarget(localPlayer, target, weapon);
    this.aimToTarget(localPlayer.camera, finalVec, weapon);

    if(this.isInHeadSnapZone(localPlayer.camera, finalVec)) {
      this.triggerAutoFire();
    }
  }
}

// === Config ===
const aimLockConfig = {
  bindposeOffset: {
    x: -0.0456970781,
    y: -0.004478302,
    z: -0.0200432576
  },
  snap_radius: 0.09,
  recoil: {
    mp40: { x: 0.02, y: 0.015 },
    m1887: { x: 0.03, y: 0.02 },
    awm: { x: 0.01, y: 0.008 },
    ak: { x: 0.025, y: 0.02 },
    default: { x: 0, y: 0 }
  },
  weapon_gain: {
    default: { yaw: 0.5, pitch: 0.48 },
    m1887: { yaw: 0.52, pitch: 0.49 },
    mp40: { yaw: 0.53, pitch: 0.5 },
    awm: { yaw: 0.4, pitch: 0.4 },
    ak: { yaw: 0.6, pitch: 0.52 }
  }
};

let aimLockEngine = null;

function initAimLock() {
  aimLockEngine = new AimLockEngine(aimLockConfig);

  setInterval(() => {
    const localPlayer = getLocalPlayer();
    const enemies = getEnemies();
    const currentWeapon = getCurrentWeapon();

    if(aimLockEngine && localPlayer && enemies?.length > 0){
      aimLockEngine.update(localPlayer, enemies, currentWeapon);
    }
  }, 16);
}

// == MOCK & UTILS ==
function getLocalPlayer() {
  return {
    x: 0, y: 1.7, z: 0,
    camera: {
      position: { x: 0, y: 1.7, z: 0 },
      target: { x: 0, y: 1.7, z: 1 }
    },
    cameraYaw: 0
  };
}

function getEnemies() {
  return [
    {
      health: 100,
      armorLevel: 2,
      velocity: { x: 0, y: 0, z: -0.05 },

      // Gốc nhân vật (nếu cần dùng)
      x: 2.0,
      y: 1.7,
      z: 5.0,

      // Tọa độ thực tế của bone_Head
      head: {
        x: -0.0456970781,
        y: -0.004478302,
        z: -0.0200432576
      },

      // Bindpose thực của bone_Head
      bindpose: {
        e00: -1.34559613E-13, e01: 8.881784E-14,   e02: -1.0,           e03: 0.487912,
        e10: -2.84512817E-06, e11: -1.0,            e12: 8.881784E-14,  e13: -2.842171E-14,
        e20: -1.0,            e21: 2.84512817E-06,  e22: -1.72951931E-13, e23: 0.0,
        e30: 0.0,             e31: 0.0,             e32: 0.0,           e33: 1.0
      }
    }
  ];
}

function getCurrentWeapon() {
  // Có thể trả về nhiều loại súng khác nhau tùy logic hoặc input người dùng
  return "mp40";
}

function isFiring() {
  // Thay thế logic thật kiểm tra trạng thái bắn
  return false;
}

function simulateMouseDown() { 
  console.log("🔥 Fire down"); 
}
function simulateMouseUp() { 
  console.log("🔥 Fire up"); 
}

function sendInputToMouse({ deltaX, deltaY }) {
  // Ở đây thay bằng API hoặc hook game để di chuyển chuột/tâm ngắm
  console.log(`Move Mouse: X=${deltaX.toFixed(3)} Y=${deltaY.toFixed(3)}`);
}

// === Khởi động hệ thống AimLock ===
initAimLock();
