import { describe, it, expect } from "vitest";
import { ACTION_MODES } from "@/lib/config/runtime";

// ADR-0006 §2.2 + §6 doğrulama: tablo state'i kararlı durmalı.
describe("ACTION_MODES (ADR-0006)", () => {
  it("mid_takip ve hospital_takip auto (kalıp tutturulmuş, gradyan-auto)", () => {
    expect(ACTION_MODES.mid_takip).toBe("auto");
    expect(ACTION_MODES.hospital_takip).toBe("auto");
  });

  it("mid_cold ve hospital_cold manuel (premium ilk temas asimetrik)", () => {
    expect(ACTION_MODES.mid_cold).toBe("manual");
    expect(ACTION_MODES.hospital_cold).toBe("manual");
  });

  it("solo_cold, solo_takip, solo_fiyat auto (hız öncelikli)", () => {
    expect(ACTION_MODES.solo_cold).toBe("auto");
    expect(ACTION_MODES.solo_takip).toBe("auto");
    expect(ACTION_MODES.solo_fiyat).toBe("auto");
  });

  it("demo_reply, cikis_reply, mid_reply, hospital_reply auto", () => {
    expect(ACTION_MODES.demo_reply).toBe("auto");
    expect(ACTION_MODES.cikis_reply).toBe("auto");
    expect(ACTION_MODES.mid_reply).toBe("auto");
    expect(ACTION_MODES.hospital_reply).toBe("auto");
  });

  it("demo_followup manual (bot karışmaz, kurucu Telegram'dan görür)", () => {
    expect(ACTION_MODES.demo_followup).toBe("manual");
  });
});
