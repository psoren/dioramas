export type SimEventKind =
  | 'rocket-ignition'
  | 'rocket-launched'
  | 'cargo-delivered'
  | 'cargo-loaded'
  | 'train-held'
  | 'train-released';

export interface SimEvent {
  kind: SimEventKind;
  message: string;
  at: number; // performance.now()
}

type Listener = (event: SimEvent) => void;

const listeners = new Set<Listener>();

export function emit(kind: SimEventKind, message: string): void {
  const event: SimEvent = { kind, message, at: performance.now() };
  for (const listener of listeners) listener(event);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
