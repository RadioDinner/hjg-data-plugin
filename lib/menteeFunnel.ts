// Pure funnel / exit roll-up for the rewritten Mentee management system
// (2026-06-27). HJG's funnel branches and leaks at every step: everyone starts
// (rarely) on the Pre-Waiting List, then a Discovery call, then either continues
// to JumpStart Your Freedom or DECLINES; from JumpStart they go to 4x or QUIT
// (financial) / NO MENTORING / get FIRED; and they can GRADUATE directly from 4x
// or 2x rather than walking 4x → 2x → 1x cleanly. This computes, per stage: how
// many ENTERED it, how many are still ACTIVE there, how many EXITED there (by
// reason), and the conversion to the next stage.
//
// "Entered a stage" = reachedStage (a stage date, or — for the sequential
// pre-graduation stages — the effective status places them at/beyond it).
// Exits are attributed to the hand-set exit stage, else the furthest stage
// reached. IMN ("Independent Mentor") mentees are kept on the roster but
// EXCLUDED from the funnel and reported separately. No I/O, no React — verify §22.

import { FUNNEL_STAGES, MENTEE_EXIT_STATUSES, reachedStage, type FunnelStage, type EffectiveMentee, type MenteeMgmtStatus } from "./menteeView.js";

const STAGE_LABEL: Record<FunnelStage, string> = {
  pre_waiting: "Pre-Waiting",
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
  no_mentoring: number;
  declined: number;
}

export interface FunnelStageStat {
  stage: FunnelStage;
  label: string;
  entered: number; // reached this stage
  activeHere: number; // currently sitting at this stage (not exited / graduated)
  exits: FunnelExits; // exits attributed to this stage, by reason
  exitedHere: number; // quit + fired + no_mentoring + declined
  conversionToNext: number | null; // entered(next) / entered(this), 0..1; null at graduated
}

export interface FunnelReport {
  stages: FunnelStageStat[];
  total: number; // non-test, non-IMN mentees
  imnCount: number; // kept on the roster, excluded from the funnel
}

function emptyExits(): FunnelExits {
  return { quit: 0, fired: 0, no_mentoring: 0, declined: 0 };
}

export function computeFunnel(mentees: EffectiveMentee[]): FunnelReport {
  const live = mentees.filter((m) => !m.isTest);
  const imnCount = live.filter((m) => m.effectiveStatus === "imn" || m.resolvedStatus === "imn").length;
  const items = live.filter((m) => m.effectiveStatus !== "imn" && m.resolvedStatus !== "imn");

  const entered: Record<FunnelStage, number> = { pre_waiting: 0, discovery: 0, jumpstart: 0, "4x": 0, "2x": 0, "1x": 0, graduated: 0 };
  const exits: Record<FunnelStage, FunnelExits> = {
    pre_waiting: emptyExits(),
    discovery: emptyExits(),
    jumpstart: emptyExits(),
    "4x": emptyExits(),
    "2x": emptyExits(),
    "1x": emptyExits(),
    graduated: emptyExits(),
  };
  const activeHere: Record<FunnelStage, number> = { pre_waiting: 0, discovery: 0, jumpstart: 0, "4x": 0, "2x": 0, "1x": 0, graduated: 0 };

  for (const m of items) {
    for (const s of FUNNEL_STAGES) if (reachedStage(m, s)) entered[s]++;

    // Exit attribution. The stage is the hand status_stage if set, else the
    // furthest stage reached (currentStage), else discovery (a declined-after-
    // discovery mentee with no stage dates).
    const st = m.effectiveStatus;
    if (st != null && MENTEE_EXIT_STATUSES.includes(st)) {
      const stage = (m.statusStage ?? m.currentStage ?? "discovery") as FunnelStage;
      exits[stage][st as Exclude<MenteeMgmtStatus, "active" | "graduated" | "imn">]++;
    } else if (m.currentStage && m.resolvedStatus !== "graduated" && st !== "graduated") {
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
      exitedHere: e.quit + e.fired + e.no_mentoring + e.declined,
      conversionToNext: next ? (entered[s] ? entered[next] / entered[s] : null) : null,
    };
  });

  return { stages, total: items.length, imnCount };
}
