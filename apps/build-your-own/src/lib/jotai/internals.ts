import type { Atom } from './atom';

export type AnyValue = unknown;
export type AnyAtom = Atom<AnyValue>;
export type AnyError = unknown;

/**
 * State tracked for mounted atoms. An atom is considered "mounted" if it has a
 * subscriber, or is a transitive dependency of another atom that has a
 * subscriber.
 */
export interface AtomState<Value = AnyValue> {
  value?: Value;
  error?: AnyError;
  /** Set of listeners to notify when the atom value changes. */
  readonly listeners: Set<() => void>;
  /** Set of mounted atoms that the atom depends on. */
  readonly dependencies: Set<AnyAtom>
}

/**
 * State tracked for mounted atoms. An atom is considered "mounted" if it has a
 * subscriber, or is a transitive dependency of another atom that has a
 * subscriber.
 * The mounted state of an atom is freed once it is no longer mounted.
 */
export interface Mounted extends Pick<AtomState, 'dependencies' | 'listeners'> {
  /**
   * Set of mounted atoms that depends on this atom.
   *
   * > If B depends on A, it means that A is a dependency of B, and B is a dependent on A.
   */
  readonly dependents: Set<AnyAtom>;

  /** Function to run when the atom is unmounted. */
  onUnmount?: () => void
}

export function returnAtomValue<Value>(atomState: AtomState<Value>): Value {
  if ('error' in atomState) {
    throw atomState.error;
  }
  if (!('value' in atomState)) {
    throw new Error('atom state is not initialized');
  }
  return atomState.value as Value;
}

export function isAtomStateInitialized<Value>(
  atomState: AtomState<Value>
): boolean {
  return 'value' in atomState || 'error' in atomState;
}

export function hasInitialValue<T extends Atom<AnyValue>>(
  atom: T
): atom is T & { init: AnyValue } {
  return 'init' in atom;
}

export function isSelfAtom(atom: AnyAtom, a: AnyAtom): boolean {
  return atom === a;
}
