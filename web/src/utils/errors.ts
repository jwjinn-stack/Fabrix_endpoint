// 사용자向 에러 메시지 정규화(IMP-26) — raw API 문자열("API 503", "Failed to fetch")을
// 관제 콘솔에서 읽을 수 있는 한국어 안내로 변환. 이전엔 Settings 한 곳에만 있었고
// 타 페이지는 raw (e as Error).message 를 그대로 노출했다.
export function humanizeError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("networkerror"))
    return "서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.";
  if (m.includes("timeout") || m.includes("timed out") || m.includes("aborterror") || m.includes("the operation was aborted"))
    return "요청이 시간 초과되었습니다. 잠시 후 다시 시도하세요.";
  if (m.includes("429") || m.includes("rate limit") || m.includes("too many"))
    return "요청이 많아 일시적으로 제한되었습니다. 잠시 후 다시 시도하세요.";
  if (m.includes("403") || m.includes("forbidden") || m.includes("permission"))
    return "권한이 없습니다. 관리자에게 문의하세요.";
  if (m.includes("404") || m.includes("not found"))
    return "대상을 찾을 수 없습니다.";
  if (m.includes("invalid email") || m.includes("invalid_email"))
    return "이메일 형식이 올바르지 않습니다.";
  if (m.includes("409") || m.includes("conflict") || m.includes("already exists") || m.includes("duplicate"))
    return "이미 존재하거나 다른 작업과 충돌했습니다.";
  if (m.includes("500") || m.includes("502") || m.includes("503") || m.includes("504") || m.includes("server error"))
    return "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
  return msg;
}
