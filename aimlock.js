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
  headOffset: new Vector3(-0.04089227, 0.00907892, 0.02748467),
  snap_radius: 9999.0,
  recoil: {
    mp40: { x: 100, y: 100 },
    m1887: { x: 100, y: 100 },
    awm: { x: 100, y: 100 },
    ak: { x: 100, y: 100 },
    ump: { x: 100, y: 100 },
    m1014: { x: 100, y: 100 },
    m590: { x: 100, y: 100 },
    mac10: { x: 100, y: 100 },
    default: { x: 100, y: 100 }
  },
  weapon_gain: {
    default: { yaw: 999, pitch: 999 },
    m1887: { yaw: 999, pitch: 999 },
    mp40: { yaw: 999, pitch: 999 },
    awm: { yaw: 999, pitch: 999 },
    ak: { yaw: 999, pitch: 999 },
    ump: { yaw: 999, pitch: 999 },
    m1014: { yaw: 999, pitch: 999 },
    m590: { yaw: 999, pitch: 999 },
    mac10: { yaw: 999, pitch: 999 }
  },
  advancedFeatures: {
    QuickScopeReactionTime: 2,
    RealTimeMovementAimSync: 2,
    SmartTapFireOptimization: 2,
    LowDragFlickMode: 2,
    FeatherTouchAimingSystem: 2,
    AutoFocusTargetAssist: 2,
    DynamicAimFlowControl: 2,
    FastAimLockOnAssist: 2,
    MinimalWeightAimTuning: 2,
    QuickLightAimReset: 2,

    PrecisionAimLock: 2,
    VerticalAimFix: 2,
    HorizontalAimFix: 2,
    SmoothGripControl: 2,
    DragStabilityBalancer: 2,
    GripSensitivityTuning: 2,
    AutoAimFix: 2,
    DragSpeedAdjuster: 2,
    DragControlLimiter: 2,
    TouchGripResponse: 2,
    DynamicGripReset: 2,

    AutoCenteringFix: 2,
    RealTimeAimLock: 2,
    VerticalDragLimiter: 2,
    HorizontalDragLimiter: 2,
    HeadSnapLimiter: 2,
    DragPrecisionTuner: 2,
    GripCorrectionEnhancer: 2,
    NoExcessiveGrip: 2,
    BalancedDragControl: 2,
    RealTimePrecisionSync: 2,

    ZeroLateralMovement: 2,
    ZeroVerticalDrift: 2,
    NoAimSnapFixer: 2,
    TouchSensitivityLock: 2,
    DragReductionOptimizer: 2,
    RecoilCorrectionSystem: 2,
    DragAndDropSync: 2,
    GripForceLimiter: 2,
    ZeroFluctuationDrag: 2,

    GripStabilizer: 2,
    FastDragControl: 2,
    TouchInputCorrection: 2,
    DragSpeedLimiter: 2
  },

  // --- Aimlock Cải Tiến và Tối Ưu Hóa Cao Nhất ---
  UltraPrecisionAimLock: 5,
  FastAutoAimControl: 5,
  AdvancedAimAssist: 5,
  AutoRecoilLock: 5,
  SnapTargetAssist: 5,
  DragSyncOptimizer: 5,
  HeadshotLockPrecision: 5,
  DragControlReset: 5,
  PerfectGripSync: 5,
  DynamicAimLock: 5,

  // --- Fix Rung Mạnh và Tối Ưu Hóa Recoil ---
  SuperRecoilFix: 5,
  AntiShakeLock: 5,
  SmoothRecoilStabilizer: 5,
  VerticalRecoilPro: 5,
  HorizontalDragSyncPro: 5,
  GripRecoilSync: 5,
  AutoDragFix: 5,
  FastGripStabilizer: 5,
  PrecisionDragSync: 5,
  ZeroLateralRecoil: 5,

  // --- Giảm Lố Lạc Đạn và Tăng Độ Chính Xác ---
  BulletTrajectorySync: 5,
  NoBulletDeviation: 5,
  DragAccuracySync: 5,
  RecoilSpreadFix: 5,
  ShotSync: 5,
  BulletLockdownPrecision: 5,
  DragControlLimiter: 5,
  ZeroImpactDeviation: 5,
  ShotDragFix: 5,
  BulletImpactSync: 5,

  // --- Giảm Lag Máy và Fix Drop ---
  UltraLowLatencyTouch: 5,
  HighPerformanceFrameRate: 5,
  ZeroFrameDropControl: 5,
  RealTimeGripLatencyFix: 5,
  FastTouchResponseSync: 5,
  DragLatencyOptimized: 5,
  RealTimeFrameFixer: 5,
  InputLatencySync: 5,
  GripSyncBooster: 5,
  AdvancedFrameStabilizer: 5,

  // --- Tối Ưu Gameplay Mượt Mà và Chính Xác Hơn ---
  QuickGripSync: 5,
  DragPrecisionFix: 5,
  ZeroDragLateralMovement: 5,
  GripForceOptimizer: 5,
  RealTimeSyncGrip: 5,
  QuickDragResetSync: 5,
  DragSpeedPrecision: 5,
  NoInputLagDrag: 5,
  RecoilDragLimiter: 5,
  TouchResponseMax: 5,

  // --- Bổ Sung: Hệ thống kiểm soát Drag và Touch nâng cao ---
  CustomizableAim_Grip_Level: 1,
  AutoDrag_Reposition_System: 1,
  RealTimeGrip_Pressure_Mod: 1,
  AdvancedGrip_Balance: 1,
  FingerMotion_Assist: 1,
  DynamicTouch_Drift_Prevention: 1,
  FastGrip_Reset_Toggle: 1,
  PrecisionControl_Override: 1,
  DragStability_Sync_System: 1,
  QuickGrip_Reset_Options: 1
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
