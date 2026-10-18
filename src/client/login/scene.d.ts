export type LoginVisualState = 'idle' | 'connecting' | 'error';
export interface LoginScene {
  setState(state: LoginVisualState, options?: { passwordError?: boolean }): void;
  destroy(): void;
}
export function mountLoginScene(root: HTMLElement): LoginScene;
