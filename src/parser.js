import { readFloat32LE, readUint16LE, readInt8 } from './buffer-utils.js';

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
    this.yaw = data.yaw;
    this.pitch = data.pitch;
    this.roll = data.roll;
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
    this.suspensionFl = data.suspensionFl;
    this.suspensionFr = data.suspensionFr;
    this.suspensionRl = data.suspensionRl;
    this.suspensionRr = data.suspensionRr;
    this.tireSlipRatioFl = data.tireSlipRatioFl;
    this.tireSlipRatioFr = data.tireSlipRatioFr;
    this.tireSlipRatioRl = data.tireSlipRatioRl;
    this.tireSlipRatioRr = data.tireSlipRatioRr;
    this.tireSlipAngleFl = data.tireSlipAngleFl;
    this.tireSlipAngleFr = data.tireSlipAngleFr;
    this.tireSlipAngleRl = data.tireSlipAngleRl;
    this.tireSlipAngleRr = data.tireSlipAngleRr;
    this.carOrdinal = data.carOrdinal;
    this.carClass = data.carClass;
    this.carPi = data.carPi;
    this.drivetrainType = data.drivetrainType;
    this.tireWearFl = data.tireWearFl ?? null;
    this.tireWearFr = data.tireWearFr ?? null;
    this.tireWearRl = data.tireWearRl ?? null;
    this.tireWearRr = data.tireWearRr ?? null;
  }
}

export class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParseError';
  }
}

export function parse(buf) {
  if (buf.length < 323) {
    throw new ParseError(`packet too short: ${buf.length} bytes (need ≥323)`);
  }

  let offset = 0;

  const isRaceOn = buf.readInt32LE(offset) !== 0;
  offset += 4;
  const timestampMs = buf.readUInt32LE(offset);
  offset += 4;
  const engineMaxRpm = readFloat32LE(buf, offset);
  offset += 4;
  const engineIdleRpm = readFloat32LE(buf, offset);
  offset += 4;
  const currentEngineRpm = readFloat32LE(buf, offset);
  offset += 4;
  const accelX = readFloat32LE(buf, offset);
  offset += 4;
  const accelY = readFloat32LE(buf, offset);
  offset += 4;
  const accelZ = readFloat32LE(buf, offset);
  offset += 4;
  const velX = readFloat32LE(buf, offset);
  offset += 4;
  const velY = readFloat32LE(buf, offset);
  offset += 4;
  const velZ = readFloat32LE(buf, offset);
  offset += 4;
  offset += 12;
  const yaw = readFloat32LE(buf, offset);
  offset += 4;
  const pitch = readFloat32LE(buf, offset);
  offset += 4;
  const roll = readFloat32LE(buf, offset);
  offset += 4;
  const suspensionFl = readFloat32LE(buf, offset);
  offset += 4;
  const suspensionFr = readFloat32LE(buf, offset);
  offset += 4;
  const suspensionRl = readFloat32LE(buf, offset);
  offset += 4;
  const suspensionRr = readFloat32LE(buf, offset);
  offset += 4;
  const tireSlipRatioFl = readFloat32LE(buf, offset);
  offset += 4;
  const tireSlipRatioFr = readFloat32LE(buf, offset);
  offset += 4;
  const tireSlipRatioRl = readFloat32LE(buf, offset);
  offset += 4;
  const tireSlipRatioRr = readFloat32LE(buf, offset);
  offset += 4;
  offset += 64;
  const tireSlipAngleFl = readFloat32LE(buf, offset);
  offset += 4;
  const tireSlipAngleFr = readFloat32LE(buf, offset);
  offset += 4;
  const tireSlipAngleRl = readFloat32LE(buf, offset);
  offset += 4;
  const tireSlipAngleRr = readFloat32LE(buf, offset);
  offset += 4;
  offset += 88;
  const carOrdinal = buf.readInt32LE(offset);
  offset += 4;
  const carClass = buf.readInt32LE(offset);
  offset += 4;
  const carPi = buf.readInt32LE(offset);
  offset += 4;
  const drivetrainType = buf.readInt32LE(offset);
  offset += 4;
  offset += 4;

  offset += 12;

  const positionX = readFloat32LE(buf, offset);
  offset += 4;
  const positionY = readFloat32LE(buf, offset);
  offset += 4;
  const positionZ = readFloat32LE(buf, offset);
  offset += 4;
  const speedMs = readFloat32LE(buf, offset);
  offset += 4;
  const power = readFloat32LE(buf, offset);
  offset += 4;
  const torque = readFloat32LE(buf, offset);
  offset += 4;
  const tireTempFl = fahrenheitToCelsius(readFloat32LE(buf, offset));
  offset += 4;
  const tireTempFr = fahrenheitToCelsius(readFloat32LE(buf, offset));
  offset += 4;
  const tireTempRl = fahrenheitToCelsius(readFloat32LE(buf, offset));
  offset += 4;
  const tireTempRr = fahrenheitToCelsius(readFloat32LE(buf, offset));
  offset += 4;
  const boost = readFloat32LE(buf, offset);
  offset += 4;
  const fuel = readFloat32LE(buf, offset);
  offset += 4;
  const distanceTraveled = readFloat32LE(buf, offset);
  offset += 4;
  const bestLap = readFloat32LE(buf, offset);
  offset += 4;
  const lastLap = readFloat32LE(buf, offset);
  offset += 4;
  const currentLap = readFloat32LE(buf, offset);
  offset += 4;
  const currentRaceTime = readFloat32LE(buf, offset);
  offset += 4;
  const lapNumber = readUint16LE(buf, offset);
  offset += 2;
  const racePosition = buf[offset];
  offset += 1;
  const throttle = buf[offset];
  offset += 1;
  const brake = buf[offset];
  offset += 1;
  const clutch = buf[offset];
  offset += 1;
  const handbrake = buf[offset];
  offset += 1;
  const gear = buf[offset];
  offset += 1;
  const steer = readInt8(buf, offset);
  offset += 1;
  offset += 2;

  let tireWearFl = null;
  let tireWearFr = null;
  let tireWearRl = null;
  let tireWearRr = null;

  if (buf.length >= 327) {
    tireWearFl = readFloat32LE(buf, 323);
  }
  if (buf.length >= 331) {
    tireWearFr = readFloat32LE(buf, 327);
  }
  if (buf.length >= 335) {
    tireWearRl = readFloat32LE(buf, 331);
  }
  if (buf.length >= 339) {
    tireWearRr = readFloat32LE(buf, 335);
  }

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
    yaw,
    pitch,
    roll,
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
    suspensionFl,
    suspensionFr,
    suspensionRl,
    suspensionRr,
    tireSlipRatioFl,
    tireSlipRatioFr,
    tireSlipRatioRl,
    tireSlipRatioRr,
    tireSlipAngleFl,
    tireSlipAngleFr,
    tireSlipAngleRl,
    tireSlipAngleRr,
    carOrdinal,
    carClass,
    carPi,
    drivetrainType,
    tireWearFl,
    tireWearFr,
    tireWearRl,
    tireWearRr,
  });
}

function fahrenheitToCelsius(f) {
  return (f - 32.0) * 5.0 / 9.0;
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
    yaw: round3(packet.yaw),
    pitch: round3(packet.pitch),
    roll: round3(packet.roll),
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
    suspensionFl: round4(packet.suspensionFl),
    suspensionFr: round4(packet.suspensionFr),
    suspensionRl: round4(packet.suspensionRl),
    suspensionRr: round4(packet.suspensionRr),
    tireSlipRatioFl: round4(packet.tireSlipRatioFl),
    tireSlipRatioFr: round4(packet.tireSlipRatioFr),
    tireSlipRatioRl: round4(packet.tireSlipRatioRl),
    tireSlipRatioRr: round4(packet.tireSlipRatioRr),
    tireSlipAngleFl: round3(packet.tireSlipAngleFl),
    tireSlipAngleFr: round3(packet.tireSlipAngleFr),
    tireSlipAngleRl: round3(packet.tireSlipAngleRl),
    tireSlipAngleRr: round3(packet.tireSlipAngleRr),
    carOrdinal: packet.carOrdinal,
    carClass: packet.carClass,
    carPi: packet.carPi,
    drivetrainType: packet.drivetrainType,
    tireWearFl: packet.tireWearFl !== null ? round4(packet.tireWearFl) : null,
    tireWearFr: packet.tireWearFr !== null ? round4(packet.tireWearFr) : null,
    tireWearRl: packet.tireWearRl !== null ? round4(packet.tireWearRl) : null,
    tireWearRr: packet.tireWearRr !== null ? round4(packet.tireWearRr) : null,
  };
}

function round3(n) { return Math.round(n * 1000) / 1000; }
function round4(n) { return Math.round(n * 10000) / 10000; }
function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10) / 10; }