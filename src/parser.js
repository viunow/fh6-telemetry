import { readFloat32LE, readUint16LE, readInt8 } from "./buffer-utils.js";

export class TelemetryPacket {
  constructor(data) {
    this.isRaceOn = data.isRaceOn;
    this.timestampMs = data.timestampMs;
    this.engineMaxRpm = data.engineMaxRpm;
    this.engineIdleRpm = data.engineIdleRpm;
    this.currentEngineRpm = data.currentEngineRpm;
    this.accelX = data.accelX;
    this.accelY = data.accelY;
    this.accelZ = data.accelZ;
    this.velX = data.velX;
    this.velY = data.velY;
    this.velZ = data.velZ;
    this.angularVelocityX = data.angularVelocityX;
    this.angularVelocityY = data.angularVelocityY;
    this.angularVelocityZ = data.angularVelocityZ;
    this.yaw = data.yaw;
    this.pitch = data.pitch;
    this.roll = data.roll;
    this.suspensionFl = data.suspensionFl;
    this.suspensionFr = data.suspensionFr;
    this.suspensionRl = data.suspensionRl;
    this.suspensionRr = data.suspensionRr;
    this.tireSlipRatioFl = data.tireSlipRatioFl;
    this.tireSlipRatioFr = data.tireSlipRatioFr;
    this.tireSlipRatioRl = data.tireSlipRatioRl;
    this.tireSlipRatioRr = data.tireSlipRatioRr;
    this.wheelRotationSpeedFl = data.wheelRotationSpeedFl;
    this.wheelRotationSpeedFr = data.wheelRotationSpeedFr;
    this.wheelRotationSpeedRl = data.wheelRotationSpeedRl;
    this.wheelRotationSpeedRr = data.wheelRotationSpeedRr;
    this.wheelOnRumbleStripFl = data.wheelOnRumbleStripFl;
    this.wheelOnRumbleStripFr = data.wheelOnRumbleStripFr;
    this.wheelOnRumbleStripRl = data.wheelOnRumbleStripRl;
    this.wheelOnRumbleStripRr = data.wheelOnRumbleStripRr;
    this.wheelInPuddleFl = data.wheelInPuddleFl;
    this.wheelInPuddleFr = data.wheelInPuddleFr;
    this.wheelInPuddleRl = data.wheelInPuddleRl;
    this.wheelInPuddleRr = data.wheelInPuddleRr;
    this.surfaceRumbleFl = data.surfaceRumbleFl;
    this.surfaceRumbleFr = data.surfaceRumbleFr;
    this.surfaceRumbleRl = data.surfaceRumbleRl;
    this.surfaceRumbleRr = data.surfaceRumbleRr;
    this.tireSlipAngleFl = data.tireSlipAngleFl;
    this.tireSlipAngleFr = data.tireSlipAngleFr;
    this.tireSlipAngleRl = data.tireSlipAngleRl;
    this.tireSlipAngleRr = data.tireSlipAngleRr;
    this.tireCombinedSlipFl = data.tireCombinedSlipFl;
    this.tireCombinedSlipFr = data.tireCombinedSlipFr;
    this.tireCombinedSlipRl = data.tireCombinedSlipRl;
    this.tireCombinedSlipRr = data.tireCombinedSlipRr;
    this.suspensionTravelMetersFl = data.suspensionTravelMetersFl;
    this.suspensionTravelMetersFr = data.suspensionTravelMetersFr;
    this.suspensionTravelMetersRl = data.suspensionTravelMetersRl;
    this.suspensionTravelMetersRr = data.suspensionTravelMetersRr;
    this.carOrdinal = data.carOrdinal;
    this.carClass = data.carClass;
    this.carPi = data.carPi;
    this.drivetrainType = data.drivetrainType;
    this.numCylinders = data.numCylinders;
    this.positionX = data.positionX;
    this.positionY = data.positionY;
    this.positionZ = data.positionZ;
    this.speedMs = data.speedMs;
    this.power = data.power;
    this.torque = data.torque;
    this.tireTempFl = data.tireTempFl;
    this.tireTempFr = data.tireTempFr;
    this.tireTempRl = data.tireTempRl;
    this.tireTempRr = data.tireTempRr;
    this.boost = data.boost;
    this.fuel = data.fuel;
    this.distanceTraveled = data.distanceTraveled;
    this.bestLap = data.bestLap;
    this.lastLap = data.lastLap;
    this.currentLap = data.currentLap;
    this.currentRaceTime = data.currentRaceTime;
    this.lapNumber = data.lapNumber;
    this.racePosition = data.racePosition;
    this.throttle = data.throttle;
    this.brake = data.brake;
    this.clutch = data.clutch;
    this.handbrake = data.handbrake;
    this.gear = data.gear;
    this.steer = data.steer;
    this.normalizedDrivingLine = data.normalizedDrivingLine;
    this.normalizedAIBrakeDifference = data.normalizedAIBrakeDifference;
    // FH6 exclusive
    this.carGroup = data.carGroup;
    this.smashableVelDiff = data.smashableVelDiff;
    this.smashableMass = data.smashableMass;
  }
}

export class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ParseError";
  }
}

// FH6 packet layout (324 bytes):
//   0-7:    Status (isRaceOn s32, timestampMs u32)
//   8-19:   Engine RPM (engineMax, engineIdle, currentEngine f32)
//   20-67:  Dynamics (accel xyz, vel xyz, angVel xyz, yaw/pitch/roll f32)
//   68-83:  Normalized suspension travel (fl/fr/rl/rr f32)
//   84-99:  Tire slip ratio (fl/fr/rl/rr f32)
//   100-115: Wheel rotation speed rad/s (fl/fr/rl/rr f32)
//   116-131: Wheel on rumble strip (fl/fr/rl/rr s32)
//   132-147: Wheel in puddle depth 0-1 (fl/fr/rl/rr f32)
//   148-163: Surface rumble (fl/fr/rl/rr f32)
//   164-179: Tire slip angle (fl/fr/rl/rr f32)
//   180-195: Tire combined slip (fl/fr/rl/rr f32)
//   196-211: Suspension travel meters (fl/fr/rl/rr f32)
//   212-231: Car info (carOrdinal, carClass, carPi, drivetrainType, numCylinders s32)
//   232-243: FH6 exclusives (carGroup u32, smashableVelDiff f32, smashableMass f32)
//   244-255: Position (posX/Y/Z f32)
//   256:     Speed (speedMs f32)
//   260:     Power (power f32)
//   264:     Torque (torque f32)
//   268-283: Tire temp Fahrenheit (fl/fr/rl/rr f32) — converted to Celsius on read
//   284-295: Boost, Fuel, DistanceTraveled (f32)
//   296-311: Lap timing (bestLap, lastLap, currentLap, currentRaceTime f32)
//   312-313: lapNumber (u16)
//   314:     racePosition (u8)
//   315-319: Driver inputs (throttle/brake/clutch/handbrake/gear u8)
//   320:     steer (s8)
//   321:     normalizedDrivingLine (s8)
//   322:     normalizedAIBrakeDifference (s8)
//   323:     padding
export function parse(buf) {
  if (buf.length < 323) {
    throw new ParseError(`packet too short: ${buf.length} bytes (need ≥323)`);
  }

  let o = 0;

  // Status (0-7)
  const isRaceOn = buf.readInt32LE(o) !== 0;
  o += 4;
  const timestampMs = buf.readUInt32LE(o);
  o += 4;

  // Engine RPM (8-19)
  const engineMaxRpm = readFloat32LE(buf, o);
  o += 4;
  const engineIdleRpm = readFloat32LE(buf, o);
  o += 4;
  const currentEngineRpm = readFloat32LE(buf, o);
  o += 4;

  // Dynamics (20-67)
  const accelX = readFloat32LE(buf, o);
  o += 4;
  const accelY = readFloat32LE(buf, o);
  o += 4;
  const accelZ = readFloat32LE(buf, o);
  o += 4;
  const velX = readFloat32LE(buf, o);
  o += 4;
  const velY = readFloat32LE(buf, o);
  o += 4;
  const velZ = readFloat32LE(buf, o);
  o += 4;
  const angularVelocityX = readFloat32LE(buf, o);
  o += 4;
  const angularVelocityY = readFloat32LE(buf, o);
  o += 4;
  const angularVelocityZ = readFloat32LE(buf, o);
  o += 4;
  const yaw = readFloat32LE(buf, o);
  o += 4;
  const pitch = readFloat32LE(buf, o);
  o += 4;
  const roll = readFloat32LE(buf, o);
  o += 4;

  // Normalized suspension travel (68-83)
  const suspensionFl = readFloat32LE(buf, o);
  o += 4;
  const suspensionFr = readFloat32LE(buf, o);
  o += 4;
  const suspensionRl = readFloat32LE(buf, o);
  o += 4;
  const suspensionRr = readFloat32LE(buf, o);
  o += 4;

  // Tire slip ratio (84-99)
  const tireSlipRatioFl = readFloat32LE(buf, o);
  o += 4;
  const tireSlipRatioFr = readFloat32LE(buf, o);
  o += 4;
  const tireSlipRatioRl = readFloat32LE(buf, o);
  o += 4;
  const tireSlipRatioRr = readFloat32LE(buf, o);
  o += 4;

  // Wheel rotation speed rad/s (100-115)
  const wheelRotationSpeedFl = readFloat32LE(buf, o);
  o += 4;
  const wheelRotationSpeedFr = readFloat32LE(buf, o);
  o += 4;
  const wheelRotationSpeedRl = readFloat32LE(buf, o);
  o += 4;
  const wheelRotationSpeedRr = readFloat32LE(buf, o);
  o += 4;

  // Wheel on rumble strip (116-131)
  const wheelOnRumbleStripFl = buf.readInt32LE(o);
  o += 4;
  const wheelOnRumbleStripFr = buf.readInt32LE(o);
  o += 4;
  const wheelOnRumbleStripRl = buf.readInt32LE(o);
  o += 4;
  const wheelOnRumbleStripRr = buf.readInt32LE(o);
  o += 4;

  // Wheel in puddle depth 0.0-1.0 (132-147)
  const wheelInPuddleFl = readFloat32LE(buf, o);
  o += 4;
  const wheelInPuddleFr = readFloat32LE(buf, o);
  o += 4;
  const wheelInPuddleRl = readFloat32LE(buf, o);
  o += 4;
  const wheelInPuddleRr = readFloat32LE(buf, o);
  o += 4;

  // Surface rumble (148-163)
  const surfaceRumbleFl = readFloat32LE(buf, o);
  o += 4;
  const surfaceRumbleFr = readFloat32LE(buf, o);
  o += 4;
  const surfaceRumbleRl = readFloat32LE(buf, o);
  o += 4;
  const surfaceRumbleRr = readFloat32LE(buf, o);
  o += 4;

  // Tire slip angle (164-179)
  const tireSlipAngleFl = readFloat32LE(buf, o);
  o += 4;
  const tireSlipAngleFr = readFloat32LE(buf, o);
  o += 4;
  const tireSlipAngleRl = readFloat32LE(buf, o);
  o += 4;
  const tireSlipAngleRr = readFloat32LE(buf, o);
  o += 4;

  // Tire combined slip (180-195)
  const tireCombinedSlipFl = readFloat32LE(buf, o);
  o += 4;
  const tireCombinedSlipFr = readFloat32LE(buf, o);
  o += 4;
  const tireCombinedSlipRl = readFloat32LE(buf, o);
  o += 4;
  const tireCombinedSlipRr = readFloat32LE(buf, o);
  o += 4;

  // Suspension travel meters (196-211)
  const suspensionTravelMetersFl = readFloat32LE(buf, o);
  o += 4;
  const suspensionTravelMetersFr = readFloat32LE(buf, o);
  o += 4;
  const suspensionTravelMetersRl = readFloat32LE(buf, o);
  o += 4;
  const suspensionTravelMetersRr = readFloat32LE(buf, o);
  o += 4;

  // Car info (212-231)
  const carOrdinal = buf.readInt32LE(o);
  o += 4;
  const carClass = buf.readInt32LE(o);
  o += 4;
  const carPi = buf.readInt32LE(o);
  o += 4;
  const drivetrainType = buf.readInt32LE(o);
  o += 4;
  const numCylinders = buf.readInt32LE(o);
  o += 4;

  // FH6 exclusives (232-243) — must be read BEFORE Position per official docs
  const carGroup = buf.readUInt32LE(o);
  o += 4;
  const smashableVelDiff = readFloat32LE(buf, o);
  o += 4;
  const smashableMass = readFloat32LE(buf, o);
  o += 4;

  // Position (244-255)
  const positionX = readFloat32LE(buf, o);
  o += 4;
  const positionY = readFloat32LE(buf, o);
  o += 4;
  const positionZ = readFloat32LE(buf, o);
  o += 4;

  // Speed, power, torque (256-267)
  const speedMs = readFloat32LE(buf, o);
  o += 4;
  const power = readFloat32LE(buf, o);
  o += 4;
  const torque = readFloat32LE(buf, o);
  o += 4;

  // Tire temps Fahrenheit → Celsius (268-283)
  const tireTempFl = fahrenheitToCelsius(readFloat32LE(buf, o));
  o += 4;
  const tireTempFr = fahrenheitToCelsius(readFloat32LE(buf, o));
  o += 4;
  const tireTempRl = fahrenheitToCelsius(readFloat32LE(buf, o));
  o += 4;
  const tireTempRr = fahrenheitToCelsius(readFloat32LE(buf, o));
  o += 4;

  // Boost, fuel, distance (284-295)
  const boost = readFloat32LE(buf, o);
  o += 4;
  const fuel = readFloat32LE(buf, o);
  o += 4;
  const distanceTraveled = readFloat32LE(buf, o);
  o += 4;

  // Lap timing (296-311)
  const bestLap = readFloat32LE(buf, o);
  o += 4;
  const lastLap = readFloat32LE(buf, o);
  o += 4;
  const currentLap = readFloat32LE(buf, o);
  o += 4;
  const currentRaceTime = readFloat32LE(buf, o);
  o += 4;

  // Race position (312-314)
  const lapNumber = readUint16LE(buf, o);
  o += 2;
  const racePosition = buf[o];
  o += 1;

  // Driver inputs (315-322)
  const throttle = buf[o];
  o += 1;
  const brake = buf[o];
  o += 1;
  const clutch = buf[o];
  o += 1;
  const handbrake = buf[o];
  o += 1;
  const gear = buf[o];
  o += 1;
  const steer = readInt8(buf, o);
  o += 1;
  const normalizedDrivingLine = readInt8(buf, o);
  o += 1;
  const normalizedAIBrakeDifference = readInt8(buf, o);
  o += 1;
  // byte 323: padding

  return new TelemetryPacket({
    isRaceOn,
    timestampMs,
    engineMaxRpm,
    engineIdleRpm,
    currentEngineRpm,
    accelX,
    accelY,
    accelZ,
    velX,
    velY,
    velZ,
    angularVelocityX,
    angularVelocityY,
    angularVelocityZ,
    yaw,
    pitch,
    roll,
    suspensionFl,
    suspensionFr,
    suspensionRl,
    suspensionRr,
    tireSlipRatioFl,
    tireSlipRatioFr,
    tireSlipRatioRl,
    tireSlipRatioRr,
    wheelRotationSpeedFl,
    wheelRotationSpeedFr,
    wheelRotationSpeedRl,
    wheelRotationSpeedRr,
    wheelOnRumbleStripFl,
    wheelOnRumbleStripFr,
    wheelOnRumbleStripRl,
    wheelOnRumbleStripRr,
    wheelInPuddleFl,
    wheelInPuddleFr,
    wheelInPuddleRl,
    wheelInPuddleRr,
    surfaceRumbleFl,
    surfaceRumbleFr,
    surfaceRumbleRl,
    surfaceRumbleRr,
    tireSlipAngleFl,
    tireSlipAngleFr,
    tireSlipAngleRl,
    tireSlipAngleRr,
    tireCombinedSlipFl,
    tireCombinedSlipFr,
    tireCombinedSlipRl,
    tireCombinedSlipRr,
    suspensionTravelMetersFl,
    suspensionTravelMetersFr,
    suspensionTravelMetersRl,
    suspensionTravelMetersRr,
    carOrdinal,
    carClass,
    carPi,
    drivetrainType,
    numCylinders,
    positionX,
    positionY,
    positionZ,
    speedMs,
    power,
    torque,
    tireTempFl,
    tireTempFr,
    tireTempRl,
    tireTempRr,
    boost,
    fuel,
    distanceTraveled,
    bestLap,
    lastLap,
    currentLap,
    currentRaceTime,
    lapNumber,
    racePosition,
    throttle,
    brake,
    clutch,
    handbrake,
    gear,
    steer,
    normalizedDrivingLine,
    normalizedAIBrakeDifference,
    carGroup,
    smashableVelDiff,
    smashableMass,
  });
}

function fahrenheitToCelsius(f) {
  return ((f - 32.0) * 5.0) / 9.0;
}

export function toJSON(packet) {
  return {
    isRaceOn: packet.isRaceOn,
    timestampMs: packet.timestampMs,
    engineMaxRpm: packet.engineMaxRpm,
    engineIdleRpm: packet.engineIdleRpm,
    currentEngineRpm: packet.currentEngineRpm,
    accelX: round3(packet.accelX),
    accelY: round3(packet.accelY),
    accelZ: round3(packet.accelZ),
    velX: round3(packet.velX),
    velY: round3(packet.velY),
    velZ: round3(packet.velZ),
    angularVelocityX: round3(packet.angularVelocityX),
    angularVelocityY: round3(packet.angularVelocityY),
    angularVelocityZ: round3(packet.angularVelocityZ),
    yaw: round3(packet.yaw),
    pitch: round3(packet.pitch),
    roll: round3(packet.roll),
    suspensionFl: round4(packet.suspensionFl),
    suspensionFr: round4(packet.suspensionFr),
    suspensionRl: round4(packet.suspensionRl),
    suspensionRr: round4(packet.suspensionRr),
    tireSlipRatioFl: round4(packet.tireSlipRatioFl),
    tireSlipRatioFr: round4(packet.tireSlipRatioFr),
    tireSlipRatioRl: round4(packet.tireSlipRatioRl),
    tireSlipRatioRr: round4(packet.tireSlipRatioRr),
    wheelRotationSpeedFl: round3(packet.wheelRotationSpeedFl),
    wheelRotationSpeedFr: round3(packet.wheelRotationSpeedFr),
    wheelRotationSpeedRl: round3(packet.wheelRotationSpeedRl),
    wheelRotationSpeedRr: round3(packet.wheelRotationSpeedRr),
    wheelOnRumbleStripFl: packet.wheelOnRumbleStripFl,
    wheelOnRumbleStripFr: packet.wheelOnRumbleStripFr,
    wheelOnRumbleStripRl: packet.wheelOnRumbleStripRl,
    wheelOnRumbleStripRr: packet.wheelOnRumbleStripRr,
    wheelInPuddleFl: round3(packet.wheelInPuddleFl),
    wheelInPuddleFr: round3(packet.wheelInPuddleFr),
    wheelInPuddleRl: round3(packet.wheelInPuddleRl),
    wheelInPuddleRr: round3(packet.wheelInPuddleRr),
    surfaceRumbleFl: round3(packet.surfaceRumbleFl),
    surfaceRumbleFr: round3(packet.surfaceRumbleFr),
    surfaceRumbleRl: round3(packet.surfaceRumbleRl),
    surfaceRumbleRr: round3(packet.surfaceRumbleRr),
    tireSlipAngleFl: round3(packet.tireSlipAngleFl),
    tireSlipAngleFr: round3(packet.tireSlipAngleFr),
    tireSlipAngleRl: round3(packet.tireSlipAngleRl),
    tireSlipAngleRr: round3(packet.tireSlipAngleRr),
    tireCombinedSlipFl: round4(packet.tireCombinedSlipFl),
    tireCombinedSlipFr: round4(packet.tireCombinedSlipFr),
    tireCombinedSlipRl: round4(packet.tireCombinedSlipRl),
    tireCombinedSlipRr: round4(packet.tireCombinedSlipRr),
    suspensionTravelMetersFl: round4(packet.suspensionTravelMetersFl),
    suspensionTravelMetersFr: round4(packet.suspensionTravelMetersFr),
    suspensionTravelMetersRl: round4(packet.suspensionTravelMetersRl),
    suspensionTravelMetersRr: round4(packet.suspensionTravelMetersRr),
    carOrdinal: packet.carOrdinal,
    carClass: packet.carClass,
    carPi: packet.carPi,
    drivetrainType: packet.drivetrainType,
    numCylinders: packet.numCylinders,
    carGroup: packet.carGroup,
    smashableVelDiff: round3(packet.smashableVelDiff),
    smashableMass: round1(packet.smashableMass),
    positionX: round3(packet.positionX),
    positionY: round3(packet.positionY),
    positionZ: round3(packet.positionZ),
    speedMs: round3(packet.speedMs),
    speedKmh: round3(packet.speedMs * 3.6),
    power: round1(packet.power),
    torque: round1(packet.torque),
    tireTempFl: round1(packet.tireTempFl),
    tireTempFr: round1(packet.tireTempFr),
    tireTempRl: round1(packet.tireTempRl),
    tireTempRr: round1(packet.tireTempRr),
    boost: round2(packet.boost),
    fuel: round3(packet.fuel),
    distanceTraveled: round1(packet.distanceTraveled),
    bestLap: round3(packet.bestLap),
    lastLap: round3(packet.lastLap),
    currentLap: round3(packet.currentLap),
    currentRaceTime: round3(packet.currentRaceTime),
    lapNumber: packet.lapNumber,
    racePosition: packet.racePosition,
    throttle: packet.throttle,
    brake: packet.brake,
    clutch: packet.clutch,
    handbrake: packet.handbrake,
    gear: packet.gear,
    steer: packet.steer,
    normalizedDrivingLine: packet.normalizedDrivingLine,
    normalizedAIBrakeDifference: packet.normalizedAIBrakeDifference,
  };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
