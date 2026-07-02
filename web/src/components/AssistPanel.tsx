import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDialogA11y, useStreamingLog, StreamingLog } from "../a11y";
import ModelStatusChip from "./ModelStatusChip";
import { loadModelConfig } from "../api/modelConnection";
import { buildAssistAnswer, describeScreen, buildScreenCtx, chunkAnswer, type AssistAnswer } from "../api/assist";
import { lookupTerm } from "../api/glossary";
import type { AssistPrefill } from "./assistBus";
import type { Page } from "./Layout";

// IMP-103 — 전역 in-context Assist 패널(⌘/ '무엇이든 물어보기').
//
// 화면을 떠나지 않고 용어·현재 상황을 물어보는 전역 오버레이(Grafana Assistant·Datadog Bits 표준).
//   · **자동 화면-컨텍스트 주입(킬러)**: 열릴 때 현재 route + 마운트 위젯을 배너로 표기(IMP-105/106 seam).
//     '이 화면 설명' 원클릭 프리셋이 그 위에 있다.
//   · a11y: v1 = MODAL dialog(useDialogA11y, IMP-102) — aria-labelledby·초기 포커스·Esc·트리거 복원.
//     답변은 StreamingLog(role=log 완료 append + role=status 진행, IMP-102).
//   · **mock-first(정직)**: rule-based 답변(glossary/screen/폴백) + ModelStatusChip 로 "mock 모델" 정직 표기.
//     실 스트리밍은 IMP-110 — chunkAnswer 소스만 실 스트림으로 스왑하면 UI/낭독 계약은 불변.
//   · **읽기 전용**: mutation 경로 없음(설명·용어 렌더만).
//   · lazy import 로 로드(Layout 이 Suspense 로 감쌈) — 초기 번들 0.

// 자유질문 프리셋 — 초심자가 바로 눌러볼 등록 용어(전부 glossary 완전일치라 결정적으로 답한다).
const QUERY_PRESETS = ["TTFT란?", "backpressure란?", "p95란?"];

// 스트리밍 청크 간격(ms) — mock 답변을 자연스럽게 흘린다. prefers-reduced-motion 이면 즉시 완료.
const CHUNK_MS = 18;

export default function AssistPanel({
  open,
  onClose,
  route,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  route: Page;
  // IMP-104 — explain-this 프리필. data-explain-key/선택 팝오버가 "콕 집어" 열 때 채운다.
  //   explainKey(glossary key/alias) 우선 → 큐레이션 정의 자동 ask, 없으면 label 로 자유질문(정직 폴백).
  prefill?: AssistPrefill | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const log = useStreamingLog();
  // 진행 중 청크 타이머 — 언마운트/재실행 시 정리(누수·경합 방지).
  const timerRef = useRef<number | null>(null);

  // dialog a11y(IMP-102) — 초기 포커스 입력창, Esc 닫기, 포커스 트랩, 닫을 때 트리거 복원.
  const { dialogRef } = useDialogA11y<HTMLDivElement>({ open, onClose, initialFocusRef: inputRef });

  // IMP-82 — 로컬 모델 연결 설정(mock 기본, 정직). 칩이 "mock 모델"로 정직 표기한다.
  const modelConfig = useMemo(() => loadModelConfig(), []);

  // 자동 화면-컨텍스트 주입 — 열려 있는 동안 현재 route + 마운트 위젯을 읽는다(정보폭탄 금지·read-only).
  const ctx = useMemo(() => buildScreenCtx(route), [route]);

  // 답변을 StreamingLog 로 흘린다(begin→appendToken→commit). reduced-motion 이면 즉시 commit.
  const stream = useCallback(
    (answer: AssistAnswer) => {
      if (timerRef.current != null) { window.clearInterval(timerRef.current); timerRef.current = null; }
      log.begin();
      const chunks = chunkAnswer(answer.text);
      // reduced-motion 이거나 matchMedia 미지원(jsdom/구형)이면 한 번에 확정(접근성 + 테스트 결정성).
      const reduced = typeof window === "undefined" || typeof window.matchMedia !== "function"
        ? true
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced || chunks.length <= 1) {
        for (const c of chunks) log.appendToken(c);
        log.commit();
        return;
      }
      let i = 0;
      timerRef.current = window.setInterval(() => {
        if (i >= chunks.length) {
          if (timerRef.current != null) { window.clearInterval(timerRef.current); timerRef.current = null; }
          log.commit();
          return;
        }
        log.appendToken(chunks[i]);
        i += 1;
      }, CHUNK_MS);
    },
    [log],
  );

  // 언마운트 시 타이머 정리.
  useEffect(() => () => { if (timerRef.current != null) window.clearInterval(timerRef.current); }, []);

  // 닫힐 때 상태 초기화(재오픈 시 이전 답변 잔상 방지). 열림 상태 전이만 감지.
  useEffect(() => {
    if (!open) {
      if (timerRef.current != null) { window.clearInterval(timerRef.current); timerRef.current = null; }
      log.reset();
      setQuery("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ask = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      log.pushUser(trimmed);
      stream(buildAssistAnswer(trimmed, route));
    },
    [log, stream, route],
  );

  const explainScreen = useCallback(() => {
    log.pushUser(`이 화면(${ctx.title}) 설명`);
    stream(describeScreen(route));
  }, [log, stream, route, ctx.title]);

  // IMP-104 — 프리필 자동 ask. data-explain-key/선택 팝오버로 "콕 집어" 열렸을 때(사용자 조작 결과)
  //   해당 용어/라벨을 자동으로 물어 답을 흘린다. focus theft 아님 — 패널이 dialog 로 포커스를 받는다(IMP-102).
  //   explainKey(glossary key/alias) 우선: 등록 용어면 그 term 을, 아니면 label 로 자유질문(정직 폴백, 환각 금지).
  //   handledRef 로 동일 prefill 재발화를 막는다(open 전이 시 1회).
  const handledRef = useRef<AssistPrefill | null>(null);
  useEffect(() => {
    if (!open) {
      handledRef.current = null;
      return;
    }
    if (!prefill || handledRef.current === prefill) return;
    handledRef.current = prefill;
    // 조회는 explainKey(glossary key/alias 완전일치) 우선, 없으면 label 문자열로 자유질문(정직 폴백).
    //   buildAssistAnswer 가 key/alias 를 해석하므로 원본 문자열을 그대로 넘긴다(term.term 표시라벨은 매칭 실패 위험).
    const askText = (prefill.explainKey ?? prefill.label ?? "").trim();
    if (!askText) return;
    // 사람이 읽는 대화 라벨: 등록 용어면 term 라벨, 아니면 입력 그대로.
    const term = prefill.explainKey ? lookupTerm(prefill.explainKey) : null;
    log.pushUser(term ? term.term : (prefill.label ?? askText));
    stream(buildAssistAnswer(askText, route));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      ask(query);
      setQuery("");
    },
    [ask, query],
  );

  if (!open) return null;

  return (
    <div className="assist-overlay" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="assist-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assist-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="assist-head">
          <h2 id="assist-title" className="assist-title">
            <span aria-hidden="true" className="assist-spark">✦</span> 무엇이든 물어보기
          </h2>
          <ModelStatusChip config={modelConfig} />
          <div className="spacer" />
          <button type="button" className="icon a11y-target-min" aria-label="닫기" title="닫기 (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 자동 화면-컨텍스트 주입 배너(킬러) — 현재 route + 마운트 위젯. 정보폭탄 금지(선언된 것만). */}
        <div className="assist-ctx" aria-label="현재 화면 컨텍스트">
          <span className="assist-ctx-badge">현재 화면</span>
          <span className="assist-ctx-name">{ctx.title}</span>
          {ctx.widgetTitles.length > 0 && (
            <span className="assist-ctx-widgets muted">· 위젯 {ctx.widgetTitles.join(" · ")}</span>
          )}
        </div>

        {/* '이 화면 설명' 원클릭 프리셋 — 자동 컨텍스트 위 최상단. */}
        <div className="assist-presets" role="group" aria-label="빠른 질문">
          <button type="button" className="pill assist-explain" onClick={explainScreen}>
            이 화면 설명
          </button>
          {QUERY_PRESETS.map((p) => (
            <button key={p} type="button" className="pill" onClick={() => ask(p)}>
              {p}
            </button>
          ))}
        </div>

        {/* 답변 — StreamingLog(role=log 완료 append + role=status 진행, IMP-102). */}
        <StreamingLog
          messages={log.messages}
          draft={log.draft}
          phase={log.phase}
          statusText={log.statusText}
          labelledBy="assist-title"
        />

        {/* 질문 입력 — 초기 포커스 대상(useDialogA11y initialFocusRef). */}
        <form className="assist-form" onSubmit={onSubmit}>
          <label htmlFor="assist-input" className="sr-only">질문</label>
          <input
            id="assist-input"
            ref={inputRef}
            type="text"
            className="assist-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="용어나 지금 상황을 물어보세요 (⌘/)"
            aria-label="질문 입력"
            autoComplete="off"
          />
          <button type="submit" className="btn-primary a11y-target-min" disabled={!query.trim()}>
            묻기
          </button>
        </form>

        <p className="assist-foot muted">
          읽기 전용 · mock(rule-based) 답변입니다. 등록 용어와 ‘이 화면 설명’을 답하며, 없는 사실은 지어내지 않습니다.
        </p>
      </div>
    </div>
  );
}
