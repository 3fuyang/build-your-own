import type { Atom, WritableAtom } from './atom';

export type AnyValue = unknown;
export type AnyAtom = Atom<AnyValue>;
export type AnyError = unknown;
export type EpochNumber = number;
export type OnUnmount = () => void;
export type SetAtom<Args extends unknown[], Result> = <A extends Args>(
  ...args: A
) => Result;
export type OnMount<Args extends unknown[], Result> = <
  S extends SetAtom<Args, Result>
>(
  setAtom: S
) => OnUnmount | void;

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
  /** Map of atoms that the atom depends on. */
  readonly dependencies: Map<AnyAtom, EpochNumber>;
  /** The epoch number of the atom, which serves as a "last modified" identifier. */
  n: EpochNumber;
}

/**
 * State tracked for mounted atoms. An atom is considered "mounted" if it has a
 * subscriber, or is a transitive dependency of another atom that has a
 * subscriber.
 * The mounted state of an atom is freed once it is no longer mounted.
 */
export interface Mounted extends Pick<AtomState, 'listeners'> {
  /**
   * Set of mounted atoms that depends on this atom.
   *
   * > If B depends on A, it means that A is a dependency of B, and B is a dependent on A.
   */
  readonly dependents: Set<AnyAtom>;
  /** Set of mounted atoms that this atom depends on. */
  readonly dependencies: Set<AnyAtom>;

  /** Function to run when the atom is unmounted. */
  onUnmount?: OnUnmount;
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

export type AnyWritableAtom = WritableAtom<AnyValue, unknown[], unknown>;

export function isActuallyWritableAtom(atom: AnyAtom): atom is AnyWritableAtom {
  return !!(atom as AnyWritableAtom).write;
}
