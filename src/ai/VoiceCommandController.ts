import { CommandClient } from './CommandClient';
import { parseVoiceCommand } from './voiceCommandRouter';
import type { XRInteractionAdapter } from '../interaction/XRInteractionAdapter';
import { SceneEngine } from '../scene/SceneEngine';

export type VoiceListenState = 'idle' | 'listening' | 'transcribing' | 'executing';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export interface VoiceExecutorCallbacks {
  onStateChange?: (state: VoiceListenState, label: string) => void;
  onToast?: (message: string) => void;
  onToggleHud?: (visible?: boolean) => void;
  onAiPrompt?: (prompt: string) => Promise<void>;
}

export class VoiceCommandController {
  private engine: SceneEngine;
  private commandClient: CommandClient;
  private xrAdapter: XRInteractionAdapter | null = null;
  private callbacks: VoiceExecutorCallbacks;

  private state: VoiceListenState = 'idle';
  private stateListeners = new Set<(state: VoiceListenState, label: string) => void>();
  private recognition: SpeechRecognitionLike | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaStopTimer: number | null = null;

  constructor(
    engine: SceneEngine,
    commandClient: CommandClient,
    callbacks: VoiceExecutorCallbacks = {},
  ) {
    this.engine = engine;
    this.commandClient = commandClient;
    this.callbacks = callbacks;
  }

  bindXR(xrAdapter: XRInteractionAdapter): void {
    this.xrAdapter = xrAdapter;
  }

  bindCallbacks(callbacks: Partial<VoiceExecutorCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  getState(): VoiceListenState {
    return this.state;
  }

  onStateChange(cb: (state: VoiceListenState, label: string) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  private setState(state: VoiceListenState, label: string): void {
    this.state = state;
    this.callbacks.onStateChange?.(state, label);
    for (const cb of this.stateListeners) cb(state, label);
  }

  async toggleListening(): Promise<void> {
    if (this.state === 'listening') {
      this.stopListening();
      return;
    }
    if (this.state !== 'idle') return;

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Rec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (Rec) {
      this.startSpeechRecognition(Rec);
      return;
    }

    await this.startMediaRecorder();
  }

  stopListening(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop errors
      }
      this.recognition = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignore stop errors
      }
    }
    if (this.mediaStopTimer !== null) {
      window.clearTimeout(this.mediaStopTimer);
      this.mediaStopTimer = null;
    }
  }

  private startSpeechRecognition(Rec: new () => SpeechRecognitionLike): void {
    const rec = new Rec();
    rec.lang = navigator.language?.startsWith('fr') ? 'fr-FR' : 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    let handledResult = false;

    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        handledResult = true;
        void this.executeTranscript(transcript);
      }
    };

    rec.onerror = (ev) => {
      this.recognition = null;
      if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
        this.setState('idle', 'Microphone permission denied');
        this.callbacks.onToast?.('Microphone permission denied');
      } else {
        this.setState('idle', 'Voice ready');
      }
    };

    rec.onend = () => {
      this.recognition = null;
      if (!handledResult && this.state === 'listening') {
        this.setState('idle', 'No speech detected');
      }
    };

    this.recognition = rec;
    this.setState('listening', 'Listening... speak a command');
    try {
      rec.start();
    } catch {
      this.recognition = null;
      void this.startMediaRecorder();
    }
  }

  private async startMediaRecorder(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.callbacks.onToast?.('Microphone capture unavailable in this browser.');
      this.setState('idle', 'Voice unavailable');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const chunks: Blob[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };

      recorder.onstop = () => {
        if (this.mediaStopTimer !== null) {
          window.clearTimeout(this.mediaStopTimer);
          this.mediaStopTimer = null;
        }
        this.releaseStream();
        this.mediaRecorder = null;

        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 250) {
          this.setState('idle', 'No audio captured');
          return;
        }
        void this.transcribeAndExecute(blob);
      };

      this.mediaRecorder = recorder;
      recorder.start();
      this.setState('listening', 'Recording... click again to send (max 6s)');
      this.mediaStopTimer = window.setTimeout(() => {
        if (this.mediaRecorder?.state === 'recording') {
          this.mediaRecorder.stop();
        }
      }, 6000);
    } catch {
      this.releaseStream();
      this.callbacks.onToast?.('Microphone access denied or unavailable');
      this.setState('idle', 'Microphone unavailable');
    }
  }

  private releaseStream(): void {
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
  }

  private async transcribeAndExecute(blob: Blob): Promise<void> {
    this.setState('transcribing', 'Transcribing voice...');
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read recorded audio'));
        reader.readAsDataURL(blob);
      });
      const transcript = await this.commandClient.transcribeAudio(
        blob.type || 'audio/webm',
        base64Data,
      );
      if (!transcript) {
        this.callbacks.onToast?.('Could not hear a voice command.');
        this.setState('idle', 'Voice ready');
        return;
      }
      await this.executeTranscript(transcript);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voice transcription failed.';
      this.callbacks.onToast?.(msg);
      this.setState('idle', msg);
    }
  }

  async executeTranscript(transcript: string): Promise<void> {
    const action = parseVoiceCommand(transcript);
    this.setState('executing', `Heard: "${transcript}"`);

    try {
      switch (action.type) {
        case 'undo': {
          const ok = this.engine.undo();
          this.callbacks.onToast?.(ok ? 'Voice: Undo applied' : 'Voice: Nothing to undo');
          break;
        }
        case 'redo': {
          const ok = this.engine.redo();
          this.callbacks.onToast?.(ok ? 'Voice: Redo applied' : 'Voice: Nothing to redo');
          break;
        }
        case 'clear': {
          this.engine.clearScene();
          this.callbacks.onToast?.('Voice: Scene cleared');
          break;
        }
        case 'delete_selected': {
          const id = this.engine.getSelectedId();
          if (id) {
            this.engine.deleteObject(id);
            this.callbacks.onToast?.('Voice: Deleted selected object');
          } else {
            this.callbacks.onToast?.('Voice: Select an object first');
          }
          break;
        }
        case 'duplicate_selected': {
          const id = this.engine.getSelectedId();
          if (id) {
            this.engine.duplicateObject(id);
            this.callbacks.onToast?.('Voice: Duplicated selected object');
          } else {
            this.callbacks.onToast?.('Voice: Select an object first');
          }
          break;
        }
        case 'rotate_selected': {
          const id = this.engine.getSelectedId();
          const obj = id ? this.engine.state.getObject(id) : undefined;
          if (id && obj) {
            this.engine.updateObjectTransform(id, {
              rotation_y: obj.rotation_y + action.deltaRad,
            });
            this.callbacks.onToast?.('Voice: Rotated object');
          } else {
            this.callbacks.onToast?.('Voice: Select an object first');
          }
          break;
        }
        case 'scale_selected': {
          const id = this.engine.getSelectedId();
          const obj = id ? this.engine.state.getObject(id) : undefined;
          if (id && obj) {
            this.engine.updateObjectTransform(id, {
              scale: obj.scale * action.factor,
            });
            this.callbacks.onToast?.('Voice: Rescaled object');
          } else {
            this.callbacks.onToast?.('Voice: Select an object first');
          }
          break;
        }
        case 'select_cycle': {
          const objects = this.engine.state.getAllObjects();
          if (objects.length === 0) {
            this.callbacks.onToast?.('Voice: Scene is empty');
            break;
          }
          const currIdx = objects.findIndex((o) => o.id === this.engine.getSelectedId());
          const nextIdx =
            currIdx === -1
              ? 0
              : (currIdx + action.dir + objects.length) % objects.length;
          const nextObj = objects[nextIdx];
          this.engine.setSelectedId(nextObj.id);
          this.callbacks.onToast?.(`Selected ${nextObj.label}`);
          break;
        }
        case 'atmosphere': {
          this.engine.setAtmosphere(action.preset);
          this.callbacks.onToast?.(`Voice: Atmosphere set to ${action.preset}`);
          break;
        }
        case 'toggle_hud': {
          this.callbacks.onToggleHud?.(action.visible);
          break;
        }
        case 'reanchor': {
          this.xrAdapter?.reAnchorTabletop();
          this.callbacks.onToast?.('Voice: AR tabletop anchor reset');
          break;
        }
        case 'spawn': {
          this.engine.spawnManual(action.assetId);
          this.callbacks.onToast?.(`Voice: Added ${action.assetName}`);
          break;
        }
        case 'ai': {
          if (this.callbacks.onAiPrompt) {
            await this.callbacks.onAiPrompt(action.prompt);
          } else {
            const res = await this.commandClient.sendPrompt({
              prompt: action.prompt,
              mode: 'chat',
              sceneState: this.engine.state.getAllObjects(),
              atmosphere: this.engine.state.atmosphere,
            });
            this.engine.applyCommandBatch(res.batch, action.prompt.slice(0, 48));
            this.callbacks.onToast?.(res.batch.assistantMessage || 'Voice command applied');
          }
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voice command failed';
      this.callbacks.onToast?.(msg);
    } finally {
      this.setState('idle', `Last: "${transcript}"`);
    }
  }
}
