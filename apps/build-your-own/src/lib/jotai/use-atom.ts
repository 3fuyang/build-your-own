import type { Atom, Getter } from './atom';

type AnyValue = unknown;
type AnyAtom = Atom<AnyValue>;

/**
 * State tracked for mounted atoms. An atom is considered "mounted" if it has a
 * subscriber, or is a transitive dependency of another atom that has a
 * subscriber.
 */
interface AtomState<Value = AnyValue> {
  value?: Value;
  /** Set of listeners to notify when the atom value changes */
  readonly listeners: Set<() => void>;
  /** Set of mounted atoms that depends on this atom */
  readonly dependents: Set<AnyAtom>;
}

const atomStateMap: WeakMap<AnyAtom, AtomState> = new WeakMap();

/**
 * This is a simplified version of the `store.get()` function in
 * jotai's actual implementation.
 */
function readAtomState<Value>(atom: Atom<Value>): AtomState<Value> {
  // Ensure the mounted state of this atom
  // exists in the current map
  const atomState = ensureAtomState(atom);
  // Get the value of this atom,
  // meanwhile tracks its dependents
  const getter: Getter = <V>(a: Atom<V>) => {
    if (isSelfAtom(a, atom)) {
      return atomState.value as V;
    }
    const aState = readAtomState(a);
    aState.dependents.add(atom);
    return aState.value as V;
  };

  // Calls user provided read function here
  const value = atom.read(getter);
  atomState.value = value;

  return atomState;
}

function ensureAtomState<Value>(atom: Atom<Value>): AtomState<Value> {
  let atomState = atomStateMap.get(atom) as AtomState<Value> | undefined;
  if (!atomState) {
    atomState = {
      listeners: new Set(),
      dependents: new Set(),
    };
    atomStateMap.set(atom, atomState);
  }
  return atomState;
}

function isSelfAtom(atom: AnyAtom, a: AnyAtom): boolean {
  return atom === a;
}
