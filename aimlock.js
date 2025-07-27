// == Vector3 Class ==
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  add(v) { return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z); }
  subtract(v) { return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z); }
  multiplyScalar(s) { return new Vector3(this.x * s, this.y * s, this.z * s); }
  length() { return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2); }
  normalize() { const l = this.length(); return l > 0 ? this.multiplyScalar(1 / l) : new Vector3(); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  static zero() { return new Vector3(0, 0, 0); }
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
    this.state = {
      lastVec: new Vector3(),
      kalmanAlpha: 0.75
    };
  }

  smooth(value, prev, alpha = 0.3) {
    return alpha * value + (1 - alpha) * prev;
  }

  applyRecoil(weapon) {
    const recoil = this.config.recoil[weapon] || { x: 0, y: 0 };
    this.recoilAccumulated.x += recoil.x;
    this.recoilAccumulated.y += recoil.y;
    this.recoilAccumulated.x *= 0.0;
    this.recoilAccumulated.y *= 0.0;
    return { x: -this.recoilAccumulated.x, y: -this.recoilAccumulated.y };
  }

  predictHeadPosition(enemy, deltaTime) {
    return enemy.head.add(enemy.velocity.multiplyScalar(deltaTime));
  }

  applyKalmanFilter(current, last, alpha) {
    return new Vector3(
      alpha * current.x + (1 - alpha) * last.x,
      alpha * current.y + (1 - alpha) * last.y,
      alpha * current.z + (1 - alpha) * last.z
    );
  }

  compensateArmor(head, level = 2) {
    return new Vector3(
      head.x,
      head.y + 0.015 * (1 - level * 0.1),
      head.z
    );
  }

  getFinalTarget(localPlayer, enemy, weapon) {
    const deltaTime = 0.016;
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
    if (len === 0) return;
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
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return dist < this.config.snap_radius;
  }

  triggerAutoFire() {
    if (!isFiring()) {
      simulateMouseDown();
      setTimeout(() => simulateMouseUp(), 55);
    }
  }

smartSelect(localPlayer, enemies, fovDeg = 180) {
  const offset = this.config?.headOffset || new Vector3(-0.04089227, 0.00907892, 0.02748467); // fallback nếu chưa cấu hình

  let best = null;
  let bestScore = Infinity;

  for (const enemy of enemies) {
    if (!enemy || enemy.health <= 0) continue;

    // Tính vị trí bone head
    const head = new Vector3(
      enemy.x + offset.x,
      enemy.y + offset.y,
      enemy.z + offset.z
    );

    const dx = head.x - localPlayer.x;
    const dy = head.y - localPlayer.y;
    const dz = head.z - localPlayer.z;

    const yaw = Math.atan2(dx, dz);
    const yawDiff = Math.abs(yaw - localPlayer.cameraYaw);

    if (yawDiff > fovDeg * (Math.PI / 180)) continue;

    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const score = dist + yawDiff * 15;

    if (score < bestScore) {
      bestScore = score;
      best = { ...enemy, head };
    }
  }

  return best;
}
  update(localPlayer, enemies, weapon) {
    const target = this.smartSelect(localPlayer, enemies);
    if (!target) return;
    const finalVec = this.getFinalTarget(localPlayer, target, weapon);
    this.aimToTarget(localPlayer.camera, finalVec, weapon);
    if (this.isInHeadSnapZone(localPlayer.camera, finalVec)) {
      this.triggerAutoFire();
    }
  }
}
this.config = {
  headOffset: new Vector3(-0.04089227, 0.00907892, 0.02748467), // offset từ chân đến đầu, điều chỉnh tùy game
  // các cấu hình khác...
};
const GamePackages = {
  GamePackage1: "com.dts.freefireth",
  GamePackage2: "com.dts.freefiremax"
};
// == Config ==
const aimLockConfig = {
  headOffset: { x: -0.04089227, y: 0.00907892, z: 0.02748467 },
  snap_radius: 360.0,
  recoil: {
    mp40: { x: 0.02, y: 0.015 },
    m1887: { x: 0.03, y: 0.02 },
    awm: { x: 0.01, y: 0.008 },
    ak: { x: 0.025, y: 0.02 },
    ump: { x: 0.022, y: 0.018 },
    m1014: { x: 0.028, y: 0.019 },
    m590: { x: 0.027, y: 0.017 },
    mac10: { x: 0.02, y: 0.016 },
    default: { x: 0, y: 0 }
  },
  weapon_gain: {
    default: { yaw: 5.0, pitch: 5.0 },
    m1887: { yaw: 5.0, pitch: 5.0 },
    mp40: { yaw: 0.53, pitch: 0.5 },
    awm: { yaw: 0.4, pitch: 0.4 },
    ak: { yaw: 0.6, pitch: 0.52 },
    ump: { yaw: 5.0, pitch: 5.0 },
    m1014: { yaw: 5.0, pitch: 5.0 },
    m590: { yaw: 0.54, pitch: 0.5 },
    mac10: { yaw: 0.5, pitch: 0.47 }
  }, // ✅ Thêm dấu phẩy ở đây

  advancedFeatures: {
    QuickScopeReactionTime: 1,
    RealTimeMovementAimSync: 1,
    SmartTapFireOptimization: 1,
    LowDragFlickMode: 1,
    FeatherTouchAimingSystem: 1,
    AutoFocusTargetAssist: 1,
    DynamicAimFlowControl: 1,
    FastAimLockOnAssist: 1,
    MinimalWeightAimTuning: 1,
    QuickLightAimReset: 1,

    PrecisionAimLock: 2,
    VerticalAimFix: 1,
    HorizontalAimFix: 1,
    SmoothGripControl: 2,
    DragStabilityBalancer: 2,
    GripSensitivityTuning: 2,
    AutoAimFix: 1,
    DragSpeedAdjuster: 2,
    DragControlLimiter: 1,
    TouchGripResponse: 2,
    DynamicGripReset: 2,

    AutoCenteringFix: 2,
    RealTimeAimLock: 2,
    VerticalDragLimiter: 2,
    HorizontalDragLimiter: 2,
    HeadSnapLimiter: 1,
    DragPrecisionTuner: 2,
    GripCorrectionEnhancer: 2,
    NoExcessiveGrip: 2,
    BalancedDragControl: 2,
    RealTimePrecisionSync: 2,

    ZeroLateralMovement: 1,
    ZeroVerticalDrift: 1,
    NoAimSnapFixer: 2,
    TouchSensitivityLock: 2,
    DragReductionOptimizer: 2,
    RecoilCorrectionSystem: 1,
    DragAndDropSync: 1,
    GripForceLimiter: 1,
    ZeroFluctuationDrag: 2,

    GripStabilizer: 2,
    FastDragControl: 2,
    TouchInputCorrection: 1,
    DragSpeedLimiter: 2
  }
};
let previousHeadMap = new Map();

function updateEnemyVelocities(enemies) {
  const deltaTime = 0.016;
  for (const enemy of enemies) {
    const id = `${enemy.x.toFixed(3)}_${enemy.y.toFixed(3)}_${enemy.z.toFixed(3)}`;
    const prevHead = previousHeadMap.get(id) || enemy.head.clone();
    const newHead = enemy.head.clone();
    enemy.velocity = newHead.subtract(prevHead).multiplyScalar(1 / deltaTime);
    previousHeadMap.set(id, newHead.clone());
  }
}

// == Init System ==
function initAimLock() {
  aimLockEngine = new AimLockEngine(aimLockConfig);
  setInterval(() => {
    const localPlayer = getLocalPlayer();
    const enemies = getEnemies();
    updateEnemyVelocities(enemies); // 🆕 Cập nhật velocity mỗi frame
    const currentWeapon = getCurrentWeapon();
    if (aimLockEngine && localPlayer && enemies?.length > 0) {
      aimLockEngine.update(localPlayer, enemies, currentWeapon);
    }
  }, 8);
}

// == Mocks for Shadowrocket or simulation ==
function getLocalPlayer() {
  return {
    x: 0, y: 1.7, z: 0,
    camera: {
      position: { x: 0, y: 1.7, z: 0 },
      target: { x: -0.0456970781, y: -0.004478302, z: -0.0200432576 }
    },
    cameraYaw: 0
  };
}
function getEnemies() {
  return [{
    health: 500,
    armorLevel: 2,
    x: 2.0, y: 1.7, z: 5.0,
    head: new Vector3(-0.0456970781, -0.004478302, -0.0200432576),
    velocity: Vector3.zero(), // sẽ được cập nhật tự động
    bindpose: {
      e00: -1.34559613E-13, e01: 8.881784E-14, e02: -1.0, e03: 0.487912,
      e10: -2.84512817E-06, e11: -1.0, e12: 8.881784E-14, e13: -2.842171E-14,
      e20: -1.0, e21: 2.84512817E-06, e22: -1.72951931E-13, e23: 0.0,
      e30: 0.0, e31: 0.0, e32: 0.0, e33: 1.0
    }
  }];
}

function getCurrentWeapon() {
  // Bạn có thể cập nhật từ API game thật hoặc điều kiện người dùng
  return "m1887";
}
function isFiring() { return false; }
function simulateMouseDown() { console.log("🔥 Fire down"); }
function simulateMouseUp() { console.log("🔥 Fire up"); }
function sendInputToMouse({ deltaX, deltaY }) {
  console.log(`Move Mouse: X=${deltaX.toFixed(3)} Y=${deltaY.toFixed(3)}`);
}

// Start
initAimLock();
