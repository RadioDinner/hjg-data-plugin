// Pure funnel / exit roll-up for the rebuilt Mentee management system (2026-06-24).
// HJG's funnel branches and leaks at every step: everyone starts at a discovery
// call, then either continues to JumpStart or DECLINES; from JumpStart they go to
// 4x or QUIT (financial) / get FIRED; and they can GRADUATE directly from 4x or 2x
// rather than walking 4x → 2x → 1x cleanly. This computes, per stage: how many
// ENTERED it, how many are still ACTIVE there, how many EXITED there (by reason),
// and the conversion to the next stage.
//
// "Entered a stage" = that stage has an effective date (graduation also counts a
// hand `graduated` status) — so a mentee who graduated from 4x is NOT counted as
// having entered 2x/1x. Exits are attributed to the hand-set exit stage, else the
// furthest stage the mentee reached. No I/O, no React — verify §22.

import { FUNNEL_STAGES, type FunnelStage, type EffectiveMentee } from "./menteeView.js";

const STAGE_LABEL: Record<FunnelStage, string> = {
  discovery: "Discovery",
  jumpstart: "JumpStart",
  "4x": "4x",
  "2x": "2x",
  "1x": "1x",
  graduated: "Graduated",
};

export interface FunnelExits {
  quit: number;
  fired: number;
  declined: number;
  paused: number;
}

export interface FunnelStageStat {
  stage: FunnelStage;
  label: string;
  entered: number; // reached this stage (has its date)
  activeHere: number; // currently sitting at this stage (not exited / graduated)
  exits: FunnelExits; // exits attributed to this stage, by reason
  exitedHere: number; // quit + fired + declined (paused is not a terminal exit)
  conversionToNext: number | null; // entered(next) / entered(this), 0..1; null at graduated
}

export interface FunnelReport {
  stages: FunnelStageStat[];
  total: number; // non-test mentees
}

// True when the mentee has reached `stage` (its effective date is set; graduated
// also honors a hand `graduated` status even without a date).
function reached(m: EffectiveMentee, stage: FunnelStage): boolean {
  switch (stage) {
    case "discovery":
      return m.discoveryDate != null;
    case "jumpstart":
      return m.jumpstartDate != null;
    case "4x":
      return m.tier4xDate != null;
    case "2x":
      return m.tier2xDate != null;
    case "1x":
      return m.tier1xDate != null;
    case "graduated":
      return m.graduationDate != null || m.status === "graduated";
  }
}

export function computeFunnel(mentees: EffectiveMentee[]): FunnelReport {
  const items = mentees.filter((m) => !m.isTest);
  const entered: Record<FunnelStage, number> = { discovery: 0, jumpstart: 0, "4x": 0, "2x": 0, "1x": 0, graduated: 0 };
  const exits: Record<FunnelStage, FunnelExits> = {
    discovery: { quit: 0, fired: 0, declined: 0, paused: 0 },
    jumpstart: { quit: 0, fired: 0, declined: 0, paused: 0 },
    "4x": { quit: 0, fired: 0, declined: 0, paused: 0 },
    "2x": { quit: 0, fired: 0, declined: 0, paused: 0 },
    "1x": { quit: 0, fired: 0, declined: 0, paused: 0 },
    graduated: { quit: 0, fired: 0, declined: 0, paused: 0 },
  };
  const activeHere: Record<FunnelStage, number> = { discovery: 0, jumpstart: 0, "4x": 0, "2x": 0, "1x": 0, graduated: 0 };

  for (const m of items) {
    for (const s of FUNNEL_STAGES) if (reached(m, s)) entered[s]++;

    // Exit attribution (quit / fired / declined / paused). The stage is the hand
    // status_stage if set, else the furthest stage reached (currentStage), else
    // discovery (a declined-after-discovery mentee with no stage dates).
    const st = m.status;
    if (st === "quit" || st === "fired" || st === "declined" || st === "paused") {
      const stage = (m.statusStage ?? m.currentStage ?? "discovery") as FunnelStage;
      exits[stage][st]++;
    } else if (m.currentStage && m.status !== "graduated" && m.resolvedStatus !== "graduated") {
      // Not exited, not graduated => still active at their current stage.
      activeHere[m.currentStage]++;
    }
  }

  const stages: FunnelStageStat[] = FUNNEL_STAGES.map((s, i) => {
    const next = FUNNEL_STAGES[i + 1];
    const e = exits[s];
    return {
      stage: s,
      label: STAGE_LABEL[s],
      entered: entered[s],
      activeHere: activeHere[s],
      exits: e,
      exitedHere: e.quit + e.fired + e.declined,
      conversionToNext: next ? (entered[s] ? entered[next] / entered[s] : null) : null,
    };
  });

  return { stages, total: items.length };
}
