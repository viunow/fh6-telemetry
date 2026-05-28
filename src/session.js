export class SessionManager {
  constructor(autoRecord = true) {
    this.autoRecord = autoRecord;
    this.activeId = null;
    this.bestLap = Infinity;
    this.lastRaceTime = 0;
    this.peakRaceTime = 0;
    this.prevCurrentLap = 0;
    this.curLapPeak = 0;
    this.prevRaceTime = 0;
    this.rewindGuard = 0;
    this.lapsRecorded = 0;
    this.ticks = 0;
    this.closedId = null;
    this.closedWallMs = 0;
    this.lastRaceTimeAtClose = 0;
    this.carOrdinal = 0;
    this.carClass = 0;
    this.carPi = 0;
  }

  static REWIND_WINDOW_MS = 30000;
  static REWIND_MIN_RACE_TIME = 5.0;
  static MIN_LAP_SECS = 20.0;
  static REWIND_GUARD_TICKS = 60;

  beginNewSession() {
    this.bestLap = Infinity;
    this.prevCurrentLap = 0;
    this.curLapPeak = 0;
    this.prevRaceTime = 0;
    this.rewindGuard = 0;
    this.lapsRecorded = 0;
    this.ticks = 0;
    this.peakRaceTime = 0;
  }

  updateBestLap(lap) {
    if (lap > 0 && lap < this.bestLap) {
      this.bestLap = lap;
    }
  }

  bestForClose() {
    return this.bestLap === Infinity ? -1 : this.bestLap;
  }

  noteTick(isRaceOn, currentLap, raceTime) {
    this.ticks++;
    if (currentLap > this.curLapPeak) {
      this.curLapPeak = currentLap;
    }

    if (!isRaceOn || (raceTime > 0 && raceTime + 0.25 < this.prevRaceTime)) {
      this.rewindGuard = SessionManager.REWIND_GUARD_TICKS;
    }
    if (raceTime > 0) {
      this.prevRaceTime = raceTime;
    }

    let completed = null;
    if (
      isRaceOn &&
      this.rewindGuard === 0 &&
      this.prevCurrentLap > SessionManager.MIN_LAP_SECS &&
      currentLap < 1.0
    ) {
      const t = this.curLapPeak;
      this.curLapPeak = currentLap;
      const idx = this.lapsRecorded;
      this.lapsRecorded++;
      this.updateBestLap(t);
      completed = { lapNumber: idx, lapTime: t };
    }

    if (this.rewindGuard > 0 && isRaceOn) {
      this.rewindGuard--;
    }
    this.prevCurrentLap = currentLap;
    return completed;
  }

  finalizeFinalLap() {
    const t = this.curLapPeak;
    const floor = this.bestLap === Infinity ? 10 : Math.max(0.5 * this.bestLap, 10);
    if (t >= floor) {
      this.updateBestLap(t);
      return { lapNumber: this.lapsRecorded, lapTime: t };
    }
    return null;
  }

  updateRaceTime(t) {
    this.lastRaceTime = t;
    if (t > this.peakRaceTime) {
      this.peakRaceTime = t;
    }
  }

  noteClose(wallMs) {
    this.closedId = this.activeId;
    this.closedWallMs = wallMs;
    this.lastRaceTimeAtClose = this.peakRaceTime;
  }

  checkReopen(newRaceTime, nowWallMs) {
    if (this.closedId === null) return null;
    const gapMs = nowWallMs - this.closedWallMs;
    if (
      gapMs < SessionManager.REWIND_WINDOW_MS &&
      newRaceTime > SessionManager.REWIND_MIN_RACE_TIME &&
      newRaceTime < this.lastRaceTimeAtClose
    ) {
      const id = this.closedId;
      this.closedId = null;
      return id;
    }
    return null;
  }

  onRaceOnChange(wasRacing, isRacing, carOrdinal, carClass, carPi) {
    if (!wasRacing && isRacing && this.autoRecord) {
      this.carOrdinal = carOrdinal;
      this.carClass = carClass;
      this.carPi = carPi;
      return 'open';
    }
    if (wasRacing && !isRacing && this.activeId !== null) {
      return 'close';
    }
    return 'none';
  }
}

export class CompletedLap {
  constructor(lapNumber, lapTime) {
    this.lapNumber = lapNumber;
    this.lapTime = lapTime;
  }
}