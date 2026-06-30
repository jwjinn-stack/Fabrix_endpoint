import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 커스텀 폴백. 없으면 기본 .state.error 폴백을 그린다. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 이 값이 바뀌면 에러 상태를 자동 리셋(라우트/range 전환 시 재마운트 효과). */
  resetKey?: unknown;
  /** 진단 로그·폴백 문구에 쓰는 영역 이름(예: "dashboard", "추세 위젯"). */
  label?: string;
}

interface State {
  error: Error | null;
}

// 무의존 in-house ErrorBoundary(react 19). 렌더 throw 를 잡아 트리 전체 언마운트(백스크린)를
// 막고 해당 영역만 폴백으로 대체한다. resetKey 변경 시 자동 복구(다른 페이지로 이동 등).
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 진단 로깅(향후 /diagnostics 인프라로 보고 여지). 콘솔에 영역+스택을 남긴다.
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ""}]`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // 라우트/range 등 resetKey 가 바뀌면 이전 에러를 해제해 재마운트를 시도한다.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="state error" role="alert">
        <strong>이 영역을 표시할 수 없습니다.</strong>
        <p className="eb-hint">일시적 오류일 수 있습니다. 다시 시도하거나 페이지를 새로고침하세요.</p>
        {import.meta.env.DEV && <pre className="eb-detail">{error.message}</pre>}
        <button type="button" className="btn" onClick={this.reset}>
          다시 시도
        </button>
      </div>
    );
  }
}
