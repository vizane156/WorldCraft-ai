/**
 * ChatPanel — conversational AI Scene Director panel.
 *
 * Features:
 *   - Scrollable message feed with starter prompts
 *   - Action summary & warning details on AI responses
 *   - Multimodal image / sketch upload (Vision-to-3D)
 *   - Web Speech API voice input (when browser supports SpeechRecognition)
 *   - AI Auto-Enhance Scene button
 *   - Error bubbles with 1-click Retry
 */

import type { CommandRequestOptions, CommandResponse } from '../ai/CommandClient';

export interface ChatSubmission {
  text: string;
  options: CommandRequestOptions;
  previewDataUrl?: string;
}

interface AttachedImage {
  name: string;
  base64: string;
  mimeType: string;
  dataUrl: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

const STARTER_PROMPTS = [
  'Build a peaceful Japanese tea garden with a cherry blossom tree, koi pond, stone lanterns, and twilight atmosphere',
  'Create a night ramen street with a ramen yatai cart, Japanese market stall, wooden bench, and red motorcycle',
  'Place a stone fountain at the center surrounded by bamboo groves, a torii gate, and golden hour lighting',
];

export class ChatPanel {
  readonly element: HTMLElement;

  private onSubmitCommand: (submission: ChatSubmission) => Promise<CommandResponse>;
  private onEnhanceScene: () => Promise<CommandResponse>;

  private feedEl: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private enhanceBtn: HTMLButtonElement;
  private collapseBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private attachmentBar: HTMLElement;
  private attachmentThumb: HTMLImageElement;
  private attachmentName: HTMLElement;
  private voiceBtn: HTMLButtonElement | null = null;
  private welcomeEl: HTMLElement;

  private attachment: AttachedImage | null = null;
  private busy = false;
  private collapsed = false;
  private recognition: SpeechRecognitionLike | null = null;
  private listening = false;
  private lastFailedSubmission: ChatSubmission | null = null;

  constructor(
    onSubmitCommand: (submission: ChatSubmission) => Promise<CommandResponse>,
    onEnhanceScene: () => Promise<CommandResponse>,
  ) {
    this.onSubmitCommand = onSubmitCommand;
    this.onEnhanceScene = onEnhanceScene;

    this.element = document.createElement('aside');
    this.element.className = 'wc-panel wc-panel-right';
    this.element.setAttribute('aria-label', 'AI Scene Director');

    // Header
    const header = document.createElement('div');
    header.className = 'wc-panel-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'wc-panel-title-wrap';

    const title = document.createElement('h2');
    title.className = 'wc-panel-title';
    title.textContent = 'AI Scene Director';

    const sub = document.createElement('div');
    sub.className = 'wc-panel-meta';
    sub.textContent = 'Multimodal Gemini Spatial Builder';

    titleWrap.append(title, sub);

    const headerActions = document.createElement('div');
    headerActions.style.display = 'flex';
    headerActions.style.gap = '6px';

    this.enhanceBtn = document.createElement('button');
    this.enhanceBtn.type = 'button';
    this.enhanceBtn.className = 'wc-btn';
    this.enhanceBtn.textContent = 'Enhance';
    this.enhanceBtn.dataset.testid = 'enhance-scene-btn';
    this.enhanceBtn.title = 'Ask Gemini to enrich and balance the current scene';
    this.enhanceBtn.addEventListener('click', () => {
      void this.triggerEnhance();
    });

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'wc-btn';
    this.collapseBtn.textContent = 'Collapse';
    this.collapseBtn.setAttribute('aria-expanded', 'true');
    this.collapseBtn.addEventListener('click', () => this.toggleCollapse());

    headerActions.append(this.enhanceBtn, this.collapseBtn);
    header.append(titleWrap, headerActions);

    // Body
    const body = document.createElement('div');
    body.className = 'wc-panel-body';

    this.feedEl = document.createElement('div');
    this.feedEl.className = 'wc-chat-feed';
    this.feedEl.setAttribute('role', 'log');
    this.feedEl.setAttribute('aria-live', 'polite');

    this.welcomeEl = this.buildWelcomeCard();
    this.feedEl.appendChild(this.welcomeEl);

    // Composer
    const composer = document.createElement('div');
    composer.className = 'wc-composer';

    this.attachmentBar = document.createElement('div');
    this.attachmentBar.className = 'wc-attachment-bar';
    this.attachmentBar.style.display = 'none';

    const attLeft = document.createElement('div');
    attLeft.style.display = 'flex';
    attLeft.style.alignItems = 'center';
    attLeft.style.gap = '8px';
    attLeft.style.minWidth = '0';

    this.attachmentThumb = document.createElement('img');
    this.attachmentThumb.className = 'wc-attachment-thumb';
    this.attachmentThumb.alt = 'Attached reference';

    this.attachmentName = document.createElement('span');
    this.attachmentName.style.overflow = 'hidden';
    this.attachmentName.style.textOverflow = 'ellipsis';
    this.attachmentName.style.whiteSpace = 'nowrap';

    attLeft.append(this.attachmentThumb, this.attachmentName);

    const removeAttBtn = document.createElement('button');
    removeAttBtn.type = 'button';
    removeAttBtn.className = 'wc-btn';
    removeAttBtn.textContent = 'Remove';
    removeAttBtn.addEventListener('click', () => this.clearAttachment());

    this.attachmentBar.append(attLeft, removeAttBtn);

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'wc-textarea';
    this.textarea.setAttribute('aria-label', 'Describe your 3D scene');
    this.textarea.placeholder =
      'Describe a scene to build, move, recolor, or attach a reference sketch...';
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.submitFromComposer();
      }
    });

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/png,image/jpeg,image/webp';
    this.fileInput.style.display = 'none';
    this.fileInput.setAttribute('aria-label', 'Upload reference image');
    this.fileInput.addEventListener('change', () => this.handleFileSelect());

    const actionsRow = document.createElement('div');
    actionsRow.className = 'wc-composer-actions';

    const toolsLeft = document.createElement('div');
    toolsLeft.className = 'wc-composer-tools';

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'wc-btn';
    uploadBtn.textContent = 'Attach Image';
    uploadBtn.addEventListener('click', () => this.fileInput.click());
    toolsLeft.appendChild(uploadBtn);

    const speechCtor = this.getSpeechRecognitionCtor();
    if (speechCtor) {
      this.voiceBtn = document.createElement('button');
      this.voiceBtn.type = 'button';
      this.voiceBtn.className = 'wc-btn';
      this.voiceBtn.textContent = 'Voice';
      this.voiceBtn.setAttribute('aria-label', 'Dictate scene command');
      this.voiceBtn.addEventListener('click', () => this.toggleVoice(speechCtor));
      toolsLeft.appendChild(this.voiceBtn);
    }

    this.sendBtn = document.createElement('button');
    this.sendBtn.type = 'button';
    this.sendBtn.className = 'wc-btn wc-btn-primary';
    this.sendBtn.textContent = 'Send';
    this.sendBtn.dataset.testid = 'chat-send-btn';
    this.sendBtn.addEventListener('click', () => {
      void this.submitFromComposer();
    });

    actionsRow.append(toolsLeft, this.sendBtn);
    composer.append(this.attachmentBar, this.textarea, this.fileInput, actionsRow);

    body.append(this.feedEl, composer);
    this.element.append(header, body);
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.element.classList.toggle('collapsed', this.collapsed);
    this.collapseBtn.textContent = this.collapsed ? 'Expand' : 'Collapse';
    this.collapseBtn.setAttribute('aria-expanded', String(!this.collapsed));
  }

  setMobileVisible(visible: boolean): void {
    this.element.classList.toggle('mobile-hidden', !visible);
  }

  private buildWelcomeCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'wc-msg wc-msg-assistant';

    const intro = document.createElement('div');
    intro.textContent =
      'Tell me what 3D world to build on the tabletop, or attach a reference photo/sketch for Vision-to-3D placement.';

    const starterList = document.createElement('div');
    starterList.className = 'wc-starter-list';

    for (const prompt of STARTER_PROMPTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wc-starter-btn';
      btn.textContent = prompt;
      btn.addEventListener('click', () => {
        void this.submitPayload({
          text: prompt,
          options: { mode: 'command' },
        });
      });
      starterList.appendChild(btn);
    }

    card.append(intro, starterList);
    return card;
  }

  private async submitFromComposer(): Promise<void> {
    if (this.busy) return;
    const text = this.textarea.value.trim();
    if (!text && !this.attachment) return;

    const finalPrompt =
      text || 'Reconstruct this reference image on the 3D tabletop using matching catalog assets.';
    const submission: ChatSubmission = {
      text: finalPrompt,
      options: {
        mode: 'command',
        ...(this.attachment
          ? {
              imageBase64: this.attachment.base64,
              imageMimeType: this.attachment.mimeType,
            }
          : {}),
      },
      previewDataUrl: this.attachment?.dataUrl,
    };

    this.textarea.value = '';
    this.clearAttachment();
    await this.submitPayload(submission);
  }

  private async submitPayload(submission: ChatSubmission): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.lastFailedSubmission = null;

    this.appendUserBubble(submission.text, submission.previewDataUrl);
    const thinkingEl = this.appendAssistantBubble('Composing spatial layout...');

    try {
      const res = await this.onSubmitCommand(submission);
      thinkingEl.remove();
      this.appendResultBubble(res);
    } catch (err) {
      thinkingEl.remove();
      this.lastFailedSubmission = submission;
      const msg =
        err instanceof Error ? err.message : 'Unable to reach AI Scene Director.';
      this.appendErrorBubble(msg);
    } finally {
      this.setBusy(false);
    }
  }

  private async triggerEnhance(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.appendUserBubble('Enhance and balance the current 3D scene');
    const thinkingEl = this.appendAssistantBubble('Reviewing spatial composition...');

    try {
      const res = await this.onEnhanceScene();
      thinkingEl.remove();
      this.appendResultBubble(res);
    } catch (err) {
      thinkingEl.remove();
      const msg =
        err instanceof Error ? err.message : 'Unable to enhance scene right now.';
      this.appendErrorBubble(msg);
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.sendBtn.disabled = busy;
    this.enhanceBtn.disabled = busy;
    this.sendBtn.textContent = busy ? 'Building...' : 'Send';
  }

  private appendUserBubble(text: string, imageDataUrl?: string): HTMLElement {
    const bubble = document.createElement('div');
    bubble.className = 'wc-msg wc-msg-user';

    if (imageDataUrl) {
      const img = document.createElement('img');
      img.className = 'wc-msg-img';
      img.src = imageDataUrl;
      img.alt = 'Uploaded scene reference';
      bubble.appendChild(img);
    }

    const body = document.createElement('div');
    body.textContent = text;
    bubble.appendChild(body);

    this.feedEl.appendChild(bubble);
    this.scrollToBottom();
    return bubble;
  }

  private appendAssistantBubble(text: string): HTMLElement {
    const bubble = document.createElement('div');
    bubble.className = 'wc-msg wc-msg-assistant';
    bubble.textContent = text;
    this.feedEl.appendChild(bubble);
    this.scrollToBottom();
    return bubble;
  }

  private appendResultBubble(res: CommandResponse): void {
    const bubble = document.createElement('div');
    bubble.className = 'wc-msg wc-msg-assistant';

    const text = document.createElement('div');
    text.textContent = res.assistant_message || 'Scene updated.';
    bubble.appendChild(text);

    if (res.actions.length > 0) {
      const counts = new Map<string, number>();
      for (const a of res.actions) {
        counts.set(a.action_type, (counts.get(a.action_type) ?? 0) + 1);
      }
      const summary = document.createElement('div');
      summary.className = 'wc-action-summary';
      summary.textContent = Array.from(counts.entries())
        .map(([k, v]) => `${k} ×${v}`)
        .join(' · ');
      bubble.appendChild(summary);
    }

    if (res.warnings.length > 0) {
      const warn = document.createElement('div');
      warn.className = 'wc-action-summary';
      warn.textContent = `Note: ${res.warnings.join(' ')}`;
      bubble.appendChild(warn);
    }

    this.feedEl.appendChild(bubble);
    this.scrollToBottom();
  }

  private appendErrorBubble(message: string): void {
    const bubble = document.createElement('div');
    bubble.className = 'wc-msg wc-msg-assistant wc-msg-error';

    const text = document.createElement('div');
    text.textContent = message;
    bubble.appendChild(text);

    if (this.lastFailedSubmission) {
      const retrySubmission = this.lastFailedSubmission;
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'wc-btn';
      retryBtn.textContent = 'Retry';
      retryBtn.style.alignSelf = 'flex-start';
      retryBtn.addEventListener('click', () => {
        bubble.remove();
        void this.submitPayload(retrySubmission);
      });
      bubble.appendChild(retryBtn);
    }

    this.feedEl.appendChild(bubble);
    this.scrollToBottom();
  }

  private handleFileSelect(): void {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx === -1) return;
      const base64 = dataUrl.slice(commaIdx + 1);
      this.attachment = {
        name: file.name,
        base64,
        mimeType: file.type || 'image/png',
        dataUrl,
      };
      this.attachmentThumb.src = dataUrl;
      this.attachmentName.textContent = file.name;
      this.attachmentBar.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  }

  private clearAttachment(): void {
    this.attachment = null;
    this.attachmentBar.style.display = 'none';
    this.attachmentThumb.removeAttribute('src');
    this.attachmentName.textContent = '';
  }

  private getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  private toggleVoice(Ctor: new () => SpeechRecognitionLike): void {
    if (this.listening && this.recognition) {
      this.recognition.stop();
      return;
    }

    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? '';
      if (transcript) {
        this.textarea.value = this.textarea.value
          ? `${this.textarea.value} ${transcript}`
          : transcript;
        this.textarea.focus();
      }
    };
    rec.onerror = () => {
      this.setVoiceState(false);
    };
    rec.onend = () => {
      this.setVoiceState(false);
    };

    this.recognition = rec;
    this.setVoiceState(true);
    rec.start();
  }

  private setVoiceState(active: boolean): void {
    this.listening = active;
    if (this.voiceBtn) {
      this.voiceBtn.textContent = active ? 'Listening...' : 'Voice';
      this.voiceBtn.classList.toggle('wc-btn-primary', active);
    }
  }

  private scrollToBottom(): void {
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
  }
}
