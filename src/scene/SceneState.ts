export type AtmospherePreset = 'daylight' | 'golden' | 'twilight';

export interface SceneObjectData {
  id: string;
  asset_id: string;
  label: string;
  position: [number, number, number];
  rotation_y: number;
  scale: number;
  color: string;
}

export interface SceneSnapshot {
  session_id: string;
  title: string;
  atmosphere: AtmospherePreset;
  version: number;
  objects: SceneObjectData[];
}

export interface SpawnCommand {
  action: 'spawn';
  asset_id: string;
  target_id?: string;
  label?: string;
  position: [number, number, number];
  rotation_y?: number;
  scale?: number;
  color?: string;
}

export interface MoveCommand {
  action: 'move';
  target_id: string;
  position?: [number, number, number];
  rotation_y?: number;
}

export interface ModifyCommand {
  action: 'modify';
  target_id: string;
  scale?: number;
  rotation_y?: number;
  color?: string;
  label?: string;
}

export interface DeleteCommand {
  action: 'delete';
  target_id: string;
}

export interface ClearCommand {
  action: 'clear';
}

export type SceneCommand =
  | SpawnCommand
  | MoveCommand
  | ModifyCommand
  | DeleteCommand
  | ClearCommand;

export interface SceneCommandBatch {
  version: '1.0';
  assistantMessage?: string;
  atmosphere?: AtmospherePreset;
  commands: SceneCommand[];
}

interface HistoryEntry {
  title: string;
  atmosphere: AtmospherePreset;
  objects: SceneObjectData[];
}

export class SceneState {
  sessionId: string;
  title = 'Untitled Spatial World';
  atmosphere: AtmospherePreset = 'daylight';
  version = 0;

  private objects = new Map<string, SceneObjectData>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistory = 40;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  getObject(id: string): SceneObjectData | undefined {
    const obj = this.objects.get(id);
    return obj ? { ...obj, position: [...obj.position] } : undefined;
  }

  getAllObjects(): SceneObjectData[] {
    return Array.from(this.objects.values()).map((obj) => ({
      ...obj,
      position: [...obj.position] as [number, number, number],
    }));
  }

  getCount(): number {
    return this.objects.size;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  checkpoint(): void {
    this.undoStack.push({
      title: this.title,
      atmosphere: this.atmosphere,
      objects: this.getAllObjects(),
    });
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(): HistoryEntry | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push({
      title: this.title,
      atmosphere: this.atmosphere,
      objects: this.getAllObjects(),
    });
    this.replaceState(prev.title, prev.atmosphere, prev.objects);
    return prev;
  }

  redo(): HistoryEntry | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push({
      title: this.title,
      atmosphere: this.atmosphere,
      objects: this.getAllObjects(),
    });
    this.replaceState(next.title, next.atmosphere, next.objects);
    return next;
  }

  replaceState(
    title: string,
    atmosphere: AtmospherePreset,
    items: SceneObjectData[],
    version?: number,
  ): void {
    this.title = title;
    this.atmosphere = atmosphere;
    if (typeof version === 'number') {
      this.version = version;
    }
    this.objects.clear();
    for (const item of items) {
      this.objects.set(item.id, {
        ...item,
        position: [...item.position] as [number, number, number],
      });
    }
  }

  upsertObject(data: SceneObjectData): void {
    this.objects.set(data.id, {
      ...data,
      position: [...data.position] as [number, number, number],
    });
  }

  removeObject(id: string): boolean {
    return this.objects.delete(id);
  }

  clear(): void {
    this.objects.clear();
  }

  toSnapshot(): SceneSnapshot {
    return {
      session_id: this.sessionId,
      title: this.title,
      atmosphere: this.atmosphere,
      version: this.version,
      objects: this.getAllObjects(),
    };
  }
}
