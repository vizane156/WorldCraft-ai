/**
 * InputWidget — floating text input for natural-language scene commands.
 * Plain HTML/CSS; works in both desktop and XR DOM Overlay modes.
 * Hidden until surfaceConfirmed fires.
 */

import type { FeedbackOverlay } from './FeedbackOverlay.js';

export type CommandHandler = (text: string) => Promise<void>;

export class InputWidget {
  private container: HTMLElement;
  private input: HTMLInputElement;
  private button: HTMLButtonElement;
  private onCommand: CommandHandler;
  private feedback: FeedbackOverlay;

  constructor(feedback: FeedbackOverlay, onCommand: CommandHandler) {
    this.feedback  = feedback;
    this.onCommand = onCommand;

    this.container = this.buildContainer();
    this.input     = this.buildInput();
    this.button    = this.buildButton();

    this.container.appendChild(this.input);
    this.container.appendChild(this.button);
    document.body.appendChild(this.container);

    this.button.addEventListener('click', () => void this.submit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.submit();
    });
  }

  /** Show the widget after the surface is confirmed. */
  show(): void {
    this.container.style.display = 'flex';
    this.input.focus();
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  private async submit(): Promise<void> {
    const text = this.input.value.trim();
    if (text.length === 0) return;
    if (this.input.disabled) return;  // guard against double-fire

    this.setEnabled(false);
    this.feedback.showLoading();

    try {
      await this.onCommand(text);
      this.input.value = '';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.feedback.showError(msg);
    } finally {
      this.feedback.hideLoading();
      this.setEnabled(true);
      this.input.focus();
    }
  }

  private setEnabled(enabled: boolean): void {
    this.input.disabled  = !enabled;
    this.button.disabled = !enabled;
    this.button.textContent = enabled ? 'Create' : '…';
  }

  private buildContainer(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'wc-input-widget';
    Object.assign(el.style, {
      display:        'none',
      position:       'fixed',
      top:            '24px',           // top of screen, not bottom
      left:           '50%',
      transform:      'translateX(-50%)',
      flexDirection:  'row',
      gap:            '8px',
      alignItems:     'center',
      background:     'rgba(20,20,20,0.75)',
      borderRadius:   '12px',
      padding:        '8px 14px',
      zIndex:         '9997',
      boxShadow:      '0 2px 16px rgba(0,0,0,0.4)',
    });
    return el;
  }

  private buildInput(): HTMLInputElement {
    const el = document.createElement('input');
    el.type        = 'text';
    el.placeholder = 'Describe your scene…';
    Object.assign(el.style, {
      width:        '320px',
      padding:      '8px 12px',
      border:       'none',
      borderRadius: '8px',
      fontSize:     '14px',
      outline:      'none',
      background:   '#2a2a2a',
      color:        '#fff',
    });
    return el;
  }

  private buildButton(): HTMLButtonElement {
    const el = document.createElement('button');
    el.textContent = 'Create';
    Object.assign(el.style, {
      padding:      '8px 18px',
      border:       'none',
      borderRadius: '8px',
      background:   '#5b5fff',
      color:        '#fff',
      fontSize:     '14px',
      cursor:       'pointer',
      fontWeight:   '600',
    });
    return el;
  }
}
