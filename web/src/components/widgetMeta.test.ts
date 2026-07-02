// IMP-105 — widgetMeta 레지스트리 + getScreenContext/describeWidget 파생 판정 가드.
import { describe, it, expect } from "vitest";
import {
  WIDGET_META,
  SCREEN_WIDGETS,
  getScreenContext,
  describeWidget,
  widgetRelatedTerms,
  widgetGoodBadValid,
} from "./widgetMeta";
import { metricThreshold, deriveVerdict, THRESHOLD_CATALOG } from "../api/thresholdCatalog";
import { glossaryTerm } from "../api/glossary";

describe("widgetMeta 레지스트리 shape", () => {
  it("모든 항목이 title·whatItShows·relatedTerms[] 를 보유", () => {
    for (const [id, meta] of Object.entries(WIDGET_META)) {
      expect(meta.title, id).toBeTruthy();
      expect(meta.whatItShows, id).toBeTruthy();
      expect(Array.isArray(meta.relatedTerms), id).toBe(true);
    }
  });

  it("goodBadRef 는 (있으면) 유효한 IMP-7 임계 카탈로그 키를 가리킨다(단일 출처)", () => {
    for (const [id, meta] of Object.entries(WIDGET_META)) {
      if (meta.goodBadRef) {
        expect(metricThreshold(meta.goodBadRef.metric), id).toBeDefined();
        expect(widgetGoodBadValid(id), id).toBe(true);
      }
    }
  });

  it("widgetMeta 에는 좋음/나쁨 임계 숫자를 인라인하지 않는다(카탈로그가 유일한 숫자 출처)", () => {
    // 메타 직렬화에 임계값(500/800/0.05 등)이 문자열로 박혀 있으면 안 됨 — 키 참조만.
    const serialized = JSON.stringify(WIDGET_META);
    for (const entry of Object.values(THRESHOLD_CATALOG)) {
      if (entry.warn != null) expect(serialized).not.toContain(String(entry.warn));
      if (entry.alert != null) expect(serialized).not.toContain(String(entry.alert));
    }
  });
});

describe("getScreenContext — on-screen only(정보폭탄 방지)", () => {
  it("dashboard 는 dashboard.* 위젯만 돌려준다", () => {
    const ctx = getScreenContext("dashboard");
    expect(ctx.route).toBe("dashboard");
    expect(ctx.widgets.length).toBe(SCREEN_WIDGETS.dashboard!.length);
    for (const w of ctx.widgets) {
      expect(w.id.startsWith("dashboard.")).toBe(true);
      expect(w.meta.title).toBeTruthy();
    }
  });

  it("다른 화면 위젯은 포함하지 않는다(앱 전체 덤프 아님)", () => {
    const ids = getScreenContext("dashboard").widgets.map((w) => w.id);
    // 전체 레지스트리보다 화면 컨텍스트가 작거나 같아야 하며, 화면 목록과 정확히 일치.
    expect(ids.sort()).toEqual([...SCREEN_WIDGETS.dashboard!].sort());
  });

  it("메타 미선언 route 는 빈 widgets", () => {
    const ctx = getScreenContext("settings");
    expect(ctx.widgets).toEqual([]);
  });
});

describe("describeWidget — 좋음/나쁨을 IMP-7 임계로 파생 + 인용", () => {
  it("lower-better 위젯: 낮은 값=양호, 위험 임계 초과=위험", () => {
    // dashboard.quality → ttft_p95 (warn 500 / alert 800, lower-better)
    const good = describeWidget("dashboard.quality", 120);
    expect(good.found).toBe(true);
    if (good.found) {
      expect(good.verdict?.verdict).toBe("good");
    }
    const bad = describeWidget("dashboard.quality", 1400);
    expect(bad.found).toBe(true);
    if (bad.found) {
      expect(bad.verdict?.verdict).toBe("bad");
      // 인용에 IMP-7 카탈로그 키가 포함(근거 추적 가능).
      expect(bad.verdict?.citation).toContain("ttft_p95");
      expect(bad.verdict?.citation).toContain("IMP-7 catalog");
    }
  });

  it("goodBadRef 없는 위젯(gpu)은 verdict 없이 설명·용어만", () => {
    const d = describeWidget("dashboard.gpu", 0.9);
    expect(d.found).toBe(true);
    if (d.found) {
      expect(d.verdict).toBeUndefined();
      expect(d.whatItShows).toBeTruthy();
      expect(d.relatedTerms.length).toBeGreaterThan(0);
    }
  });

  it("라이브 값 미제공 → 판정 불가(unknown, 지어내지 않음)", () => {
    const d = describeWidget("dashboard.quality");
    if (d.found) expect(d.verdict?.verdict).toBe("unknown");
  });
});

describe("describeWidget — 미지 위젯 HARD grounding", () => {
  it('선언 안 된 id 는 "선언된 메타 없음"', () => {
    const d = describeWidget("nope.widget");
    expect(d.found).toBe(false);
    if (!d.found) expect(d.message).toBe("선언된 메타 없음");
  });
});

describe("relatedTerms → glossary(IMP-108) 해석", () => {
  it("relatedTerms 가 glossary term 으로 해석되고 미지 term 은 제외", () => {
    for (const id of Object.keys(WIDGET_META)) {
      const terms = widgetRelatedTerms(id);
      const declared = WIDGET_META[id].relatedTerms.filter((k) => glossaryTerm(k));
      expect(terms.length).toBe(declared.length);
      for (const t of terms) expect(t.term).toBeTruthy();
    }
  });

  it("모든 widget relatedTerms key 는 실제 glossary 에 존재(끊긴 참조 없음)", () => {
    for (const [id, meta] of Object.entries(WIDGET_META)) {
      for (const key of meta.relatedTerms) {
        expect(glossaryTerm(key), `${id} → ${key}`).toBeDefined();
      }
    }
  });
});

describe("thresholdCatalog(IMP-7 단일 출처) 파생 정합", () => {
  it("lower-better 방향: alert 초과=bad, warn 초과=warn, 이하=good", () => {
    expect(deriveVerdict("ttft_p95", 900).verdict).toBe("bad");
    expect(deriveVerdict("ttft_p95", 600).verdict).toBe("warn");
    expect(deriveVerdict("ttft_p95", 100).verdict).toBe("good");
  });

  it("키 미지/값 미제공/임계 밴드 부재 → unknown", () => {
    expect(deriveVerdict("nope", 1).verdict).toBe("unknown");
    expect(deriveVerdict("ttft_p95").verdict).toBe("unknown");
    expect(deriveVerdict("throughput", 100).verdict).toBe("unknown"); // 임계 밴드 없음
  });
});
