import { describe, it, expect } from "vitest";
import { advance, onReply, onOptout, onLost, reschedule } from "@/lib/services/sequence";
import type { SequenceState } from "@/lib/domain/types";

function seq(over: Partial<SequenceState> = {}): SequenceState {
  return {
    leadId: "L1",
    currentStep: 0,
    nextActionAt: new Date(),
    lastSentAt: null,
    status: "active",
    ...over,
  };
}

const CFG = { maxSteps: 3, gapDays: 4 };
const NOW = new Date("2026-05-25T12:00:00Z");

describe("sequence state machine", () => {
  it("advance step 0 → 1, +gapDays planlar", () => {
    const r = advance(seq({ currentStep: 0 }), NOW, CFG);
    expect(r.currentStep).toBe(1);
    expect(r.status).toBe("active");
    expect(r.nextActionAt?.getTime()).toBe(NOW.getTime() + 4 * 86_400_000);
    expect(r.lastSentAt).toEqual(NOW);
  });

  it("advance son adımdan sonra completed", () => {
    const r = advance(seq({ currentStep: 3 }), NOW, CFG);
    expect(r.status).toBe("completed");
    expect(r.nextActionAt).toBeNull();
  });

  it("onReply → stopped_replied + nextActionAt null", () => {
    const r = onReply(seq({ currentStep: 1 }));
    expect(r.status).toBe("stopped_replied");
    expect(r.nextActionAt).toBeNull();
  });

  it("onOptout → stopped_optout", () => {
    expect(onOptout(seq()).status).toBe("stopped_optout");
  });

  it("onLost → durdurur", () => {
    expect(onLost(seq()).nextActionAt).toBeNull();
  });

  it("reschedule → +days erteler, aktif kalır", () => {
    const r = reschedule(seq(), 3, NOW);
    expect(r.status).toBe("active");
    expect(r.nextActionAt?.getTime()).toBe(NOW.getTime() + 3 * 86_400_000);
  });

  it("reschedule → tamamlanmış/durmuş sekansı YENİDEN AKTİFLER (parked-lead fix)", () => {
    // OOO, sekans completed olduktan sonra gelirse: status active'e çekilmeli ki
    // dueForSend (status='active' şartı) lead'i alabilsin; aksi halde sessizce düşerdi.
    const r = reschedule(seq({ status: "completed", nextActionAt: null }), 3, NOW);
    expect(r.status).toBe("active");
    expect(r.nextActionAt?.getTime()).toBe(NOW.getTime() + 3 * 86_400_000);
  });
});
