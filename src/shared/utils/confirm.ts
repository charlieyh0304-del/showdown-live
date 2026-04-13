export interface ConfirmOptions {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 위험한 동작(삭제 등)일 때 true → 확인 버튼이 빨간색 */
  destructive?: boolean;
}

type ConfirmResolver = (confirmed: boolean) => void;
type ConfirmListener = (options: ConfirmOptions, resolve: ConfirmResolver) => void;

let listener: ConfirmListener | null = null;

export function onConfirm(cb: ConfirmListener): () => void {
  listener = cb;
  return () => { listener = null; };
}

/**
 * window.confirm() 대체. ConfirmDialog 컴포넌트가 마운트되어 있어야 동작.
 * 마운트되지 않은 경우 fallback으로 window.confirm() 사용.
 */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  if (!listener) {
    return Promise.resolve(typeof window !== 'undefined' ? window.confirm(options.message) : true);
  }
  return new Promise<boolean>((resolve) => {
    listener!(options, resolve);
  });
}

// ===== Prompt (텍스트 입력) =====

export interface PromptOptions {
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

type PromptResolver = (value: string | null) => void;
type PromptListener = (options: PromptOptions, resolve: PromptResolver) => void;

let promptListener: PromptListener | null = null;

export function onPrompt(cb: PromptListener): () => void {
  promptListener = cb;
  return () => { promptListener = null; };
}

/**
 * window.prompt() 대체. PromptDialog가 마운트되어 있어야 동작.
 * 마운트되지 않은 경우 fallback으로 window.prompt() 사용.
 */
export function showPrompt(options: PromptOptions): Promise<string | null> {
  if (!promptListener) {
    return Promise.resolve(typeof window !== 'undefined' ? window.prompt(options.message, options.defaultValue) : null);
  }
  return new Promise<string | null>((resolve) => {
    promptListener!(options, resolve);
  });
}
