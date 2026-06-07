export const AgeGroups = new Set(["CHILD", "TEEN", "ADULT", "SENIOR"]);
export const TrainingModes = new Set(["STANDARD", "ASSISTED"]);
export const ScoreLevels = new Set(["EXCELLENT", "GOOD", "NORMAL", "NEEDS_PRACTICE"]);
export const GridSizes = new Set([3, 4, 5, 7]);
export const Genders = new Set(["MALE", "FEMALE", "UNDISCLOSED"]);

export const ImprovementStatus = {
  FIRST_RECORD: "FIRST_RECORD",
  IMPROVED_SPEED: "IMPROVED_SPEED",
  IMPROVED_ACCURACY: "IMPROVED_ACCURACY",
  PERSONAL_BEST: "PERSONAL_BEST",
  STABLE: "STABLE",
  MIXED: "MIXED",
  DECLINED: "DECLINED"
};

export function utcNow() {
  return new Date().toISOString();
}

export function calculateImprovement(current, previous, best) {
  if (!previous) {
    return {
      isPersonalBest: true,
      previousRecordId: null,
      improvementStatus: ImprovementStatus.FIRST_RECORD,
      timeDeltaMillis: null,
      errorDelta: null
    };
  }

  const timeDeltaMillis = current.elapsedTimeMillis - previous.elapsedTimeMillis;
  const errorDelta = current.errorCount - previous.errorCount;
  const minEffectiveDelta = Math.max(300, Math.floor(previous.elapsedTimeMillis * 0.01));
  const timeBetter = timeDeltaMillis < -minEffectiveDelta;
  const timeWorse = timeDeltaMillis > minEffectiveDelta;
  const timeClose = !timeBetter && !timeWorse;
  const isPersonalBest = !best || current.elapsedTimeMillis < best.elapsedTimeMillis;

  let improvementStatus;
  if (isPersonalBest) {
    improvementStatus = ImprovementStatus.PERSONAL_BEST;
  } else if (timeBetter && errorDelta <= 0) {
    improvementStatus = ImprovementStatus.IMPROVED_SPEED;
  } else if (timeClose && errorDelta < 0) {
    improvementStatus = ImprovementStatus.IMPROVED_ACCURACY;
  } else if (timeBetter && errorDelta > 0) {
    improvementStatus = ImprovementStatus.MIXED;
  } else if (timeClose && errorDelta === 0) {
    improvementStatus = ImprovementStatus.STABLE;
  } else {
    improvementStatus = ImprovementStatus.DECLINED;
  }

  return {
    isPersonalBest,
    previousRecordId: previous.id,
    improvementStatus,
    timeDeltaMillis,
    errorDelta
  };
}
