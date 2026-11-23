import { CommandClient } from '../ai/CommandClient';
import type { VoiceCommandController, VoiceListenState } from '../ai/VoiceCommandController';
import { SceneEngine } from '../scene/SceneEngine';

interface ChatMessageEntry {
  role: 'user' | 'assistant' | 'error';
  text: string;
  meta?: string;
  retryPrompt?: string;
  retryMode?: 'chat' | 'enhance';
}

export class ChatPanel {
  readonly element: HTMLElement;

  private engine: SceneEngine;
  private commandClient: CommandClient;
  private voiceController: VoiceCommandController | null = null;
  private onCloseMobile?: () => void;

  private messagesEl: HTMLElement;
  private textareaEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private enhanceBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private imagePreviewEl: HTMLElement;
  private imageThumbEl: HTMLImageElement;
  private imageNameEl: HTMLElement;
  private voiceBtn: HTMLButtonElement | null = null;

  private messages: ChatMessageEntry[] = [
    {
      role: 'assistant',
      text: 'Describe any 3D world, attach a reference sketch, or click Voice to speak a spatial command.',
    },
  ];
  private busy = false;
  private pendingImage: { mimeType: string; data: string; name: string } | null = null;

  constructor(
    engine: SceneEngine,
    commandClient: CommandClient,
    onCloseMobile?: () => void,
    voiceController?: VoiceCommandController,
  ) {
    this.engine = engine;
    this.commandClient = commandClient;
    this.onCloseMobile = onCloseMobile;
    this.voiceController = voiceController ?? null;

    this.element = document.createElement('aside');
    this.element.className = 'drawer drawer-right';
    this.element.setAttribute('aria-label', 'AI Scene Director');

    const header = document.createElement('div');
    header.className = 'chat-header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.style.fontSize = '13px';
    title.style.fontWeight = '700';
    title.textContent = 'AI Scene Director';
    const sub = document.createElement('div');
    sub.style.fontSize = '11px';
    sub.style.color = '#94a3b8';
    sub.textContent = 'Natural language, voice & vision-to-3D';
    titleWrap.append(title, sub);

    const headerActions = document.createElement('div');
    headerActions.style.display = 'flex';
    headerActions.style.gap = '6px';

    this.enhanceBtn = document.createElement('button');
    this.enhanceBtn.type = 'button';
    this.enhanceBtn.className = 'btn';
    this.enhanceBtn.textContent = 'Enhance';
    this.enhanceBtn.title = 'Auto-enrich and balance the current 3D scene';
    this.enhanceBtn.addEventListener('click', () => {
      void this.submitPrompt(this.textareaEl.value.trim(), 'enhance');
    });
    headerActions.appendChild(this.enhanceBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn drawer-close-mobile';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.onCloseMobile?.());
    headerActions.appendChild(closeBtn);

    header.append(titleWrap, headerActions);

    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'chat-messages';

    const composer = document.createElement('div');
    composer.className = 'chat-composer';

    const starterGrid = document.createElement('div');
    starterGrid.className = 'starter-grid';
    const starters: Array<[string, string]> = [
      [
        'Zen Courtyard',
        'Create a peaceful Japanese garden with a tea pavilion, torii gate, sakura tree, koi pond, and stone lanterns under golden lighting.',
      ],
      [
        'Cyber Outpost',
        'Build a futuristic sci-fi research outpost with a neon holotower, orbital hover rover, crystal monolith, and modern glass kiosk in twilight.',
      ],
      [
        'Medieval Keep',
        'Design a medieval village plaza with a watchtower keep, gothic stone arch, tiered fountain, pine trees, and wooden benches.',
      ],
      [
        'Night Bistro',
        'Build an atmospheric evening street market with a japanese market stall, ramen cart, cafe terrace, street lamps, and a red motorcycle.',
      ],
    ];
    for (const [label, promptText] of starters) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'starter-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        this.textareaEl.value = promptText;
        void this.submitPrompt(promptText, 'chat');
      });
      starterGrid.appendChild(btn);
    }

    this.imagePreviewEl = document.createElement('div');
    this.imagePreviewEl.className = 'image-preview-bar';
    this.imagePreviewEl.style.display = 'none';
    const previewLeft = document.createElement('div');
    previewLeft.style.display = 'flex';
    previewLeft.style.alignItems = 'center';
    previewLeft.style.gap = '7px';
    previewLeft.style.minWidth = '0';
    this.imageThumbEl = document.createElement('img');
    this.imageThumbEl.className = 'image-preview-thumb';
    this.imageThumbEl.alt = 'Reference image preview';
    this.imageNameEl = document.createElement('span');
    this.imageNameEl.style.overflow = 'hidden';
    this.imageNameEl.style.textOverflow = 'ellipsis';
    this.imageNameEl.style.whiteSpace = 'nowrap';
    previewLeft.append(this.imageThumbEl, this.imageNameEl);
    const clearImgBtn = document.createElement('button');
    clearImgBtn.type = 'button';
    clearImgBtn.className = 'btn';
    clearImgBtn.textContent = 'Remove';
    clearImgBtn.addEventListener('click', () => this.clearPendingImage());
    this.imagePreviewEl.append(previewLeft, clearImgBtn);

    this.textareaEl = document.createElement('textarea');
    this.textareaEl.className = 'chat-textarea';
    this.textareaEl.placeholder =
      'e.g. Add a vermilion torii gate facing the pond and switch to twilight...';
    this.textareaEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        void this.handleSendClick();
      }
    });

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/png,image/jpeg,image/webp';
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', () => void this.handleFileSelected());

    const actions = document.createElement('div');
    actions.className = 'composer-actions';

    const tools = document.createElement('div');
    tools.className = 'composer-tools';

    const imgBtn = document.createElement('button');
    imgBtn.type = 'button';
    imgBtn.className = 'btn';
    imgBtn.textContent = 'Image';
    imgBtn.title = 'Attach a PNG, JPEG, or WebP layout reference';
    imgBtn.addEventListener('click', () => this.fileInput.click());
    tools.appendChild(imgBtn);

    this.initVoiceControl(tools);

    this.sendBtn = document.createElement('button');
    this.sendBtn.type = 'button';
    this.sendBtn.className = 'btn btn-primary';
    this.sendBtn.textContent = 'Generate';
    this.sendBtn.addEventListener('click', () => void this.handleSendClick());

    actions.append(tools, this.sendBtn);
    composer.append(
      starterGrid,
      this.imagePreviewEl,
      this.textareaEl,
      this.fileInput,
      actions,
    );

    this.element.append(header, this.messagesEl, composer);
    this.renderMessages();
  }

  setMobileOpen(open: boolean): void {
    this.element.classList.toggle('is-open', open);
  }

  bindVoiceController(controller: VoiceCommandController): void {
    this.voiceController = controller;
    controller.onStateChange((state) => this.syncVoiceButton(state));
  }

  private syncVoiceButton(state: VoiceListenState): void {
    if (!this.voiceBtn) return;
    this.voiceBtn.classList.toggle('btn-active', state === 'listening' || state === 'transcribing');
    this.voiceBtn.textContent =
      state === 'listening'
        ? 'Listening...'
        : state === 'transcribing'
          ? 'Transcribing...'
          : state === 'executing'
            ? 'Running...'
            : 'Voice';
  }

  private initVoiceControl(container: HTMLElement): void {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'Voice';
    btn.title = 'Speak a spatial voice command or AI prompt';
    btn.addEventListener('click', () => {
      void this.voiceController?.toggleListening();
    });

    this.voiceBtn = btn;
    container.appendChild(btn);
  }

  private async handleFileSelected(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      this.messages.push({
        role: 'error',
        text: 'Please choose a PNG, JPEG, or WebP image.',
      });
      this.renderMessages();
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.readAsDataURL(file);
    });

    this.pendingImage = {
      mimeType: file.type,
      data: dataUrl,
      name: file.name,
    };
    this.imageThumbEl.src = dataUrl;
    this.imageNameEl.textContent = file.name;
    this.imagePreviewEl.style.display = 'flex';
  }

  private clearPendingImage(): void {
    this.pendingImage = null;
    this.imagePreviewEl.style.display = 'none';
  }

  private async handleSendClick(): Promise<void> {
    const prompt = this.textareaEl.value.trim();
    if (!prompt && !this.pendingImage) return;
    await this.submitPrompt(prompt, 'chat');
  }

  async submitPrompt(
    prompt: string,
    mode: 'chat' | 'enhance',
  ): Promise<void> {
    if (this.busy) return;
    const attachedImage = this.pendingImage;

    this.busy = true;
    this.sendBtn.disabled = true;
    this.enhanceBtn.disabled = true;
    this.sendBtn.textContent = 'Directing...';

    const userText =
      mode === 'enhance'
        ? prompt
          ? `Enhance scene: ${prompt}`
          : 'Enhance & enrich current layout'
        : prompt || `Analyze reference image (${attachedImage?.name || 'image'})`;

    this.messages.push({ role: 'user', text: userText });
    this.textareaEl.value = '';
    this.clearPendingImage();
    this.renderMessages();

    try {
      const result = await this.commandClient.sendPrompt({
        prompt,
        mode,
        sceneState: this.engine.state.getAllObjects(),
        atmosphere: this.engine.state.atmosphere,
        referenceImage: attachedImage
          ? { mimeType: attachedImage.mimeType, data: attachedImage.data }
          : undefined,
      });

      const applied = this.engine.applyCommandBatch(
        result.batch,
        mode === 'enhance' ? 'AI scene enhancement' : prompt.slice(0, 48),
      );

      const metaParts = [`${applied} ops`, result.model_used];
      if (result.warnings.length > 0) {
        metaParts.push(result.warnings.join(' '));
      }

      this.messages.push({
        role: 'assistant',
        text: result.batch.assistantMessage || `Applied ${applied} scene changes.`,
        meta: metaParts.join(' · '),
      });
    } catch (err) {
      this.messages.push({
        role: 'error',
        text: err instanceof Error ? err.message : 'AI director request failed.',
        retryPrompt: prompt,
        retryMode: mode,
      });
    } finally {
      this.busy = false;
      this.sendBtn.disabled = false;
      this.enhanceBtn.disabled = false;
      this.sendBtn.textContent = 'Generate';
      if (this.voiceBtn) this.voiceBtn.disabled = false;
      this.renderMessages();
    }
  }

  private renderMessages(): void {
    this.messagesEl.innerHTML = '';

    for (const msg of this.messages) {
      const item = document.createElement('div');
      item.className = `chat-msg ${msg.role}`;

      const body = document.createElement('div');
      body.textContent = msg.text;
      item.appendChild(body);

      if (msg.meta) {
        const meta = document.createElement('div');
        meta.className = 'chat-meta';
        meta.textContent = msg.meta;
        item.appendChild(meta);
      }

      if (msg.role === 'error' && msg.retryPrompt !== undefined) {
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'btn';
        retryBtn.style.marginTop = '8px';
        retryBtn.textContent = 'Retry';
        retryBtn.addEventListener('click', () => {
          void this.submitPrompt(msg.retryPrompt || '', msg.retryMode || 'chat');
        });
        item.appendChild(retryBtn);
      }

      this.messagesEl.appendChild(item);
    }

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}
