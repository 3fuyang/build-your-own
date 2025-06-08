import type { Atom, Getter, Setter, WritableAtom } from './atom';
import {
  hasInitialValue,
  isActuallyWritableAtom,
  isAtomStateInitialized,
  isSelfAtom,
  returnAtomValue,
  type AnyAtom,
  type AtomState,
  type EpochNumber,
  type Mounted,
  type OnUnmount,
} from './internals';

export interface Store {
  get: <Value>(atom: Atom<Value>) => Value;
  set: <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ) => Result;
  sub: (atom: AnyAtom, listener: () => void) => () => void;
}

interface AtomStateMap {
  get(atom: AnyAtom): AtomState | undefined;
  set(atom: AnyAtom, atomState: AtomState): void;
}

interface MountedMap {
  get(atom: AnyAtom): Mounted | undefined;
  has(atom: AnyAtom): boolean;
  set(atom: AnyAtom, mounted: Mounted): void;
  delete(atom: AnyAtom): void;
}

type InvalidatedAtoms = {
  get(atom: AnyAtom): EpochNumber | undefined;
  has(atom: AnyAtom): boolean;
  set(atom: AnyAtom, n: EpochNumber): void;
  delete(atom: AnyAtom): void;
};

interface ChangedAtoms {
  readonly size: number;
  add(atom: AnyAtom): void;
  has(atom: AnyAtom): boolean;
  clear(): void;
  forEach(callback: (atom: AnyAtom) => void): void;
  [Symbol.iterator](): IterableIterator<AnyAtom>;
}

interface Callbacks {
  readonly size: number;
  add(fn: () => void): void;
  clear(): void;
  forEach(callback: (fn: () => void) => void): void;
}

type EnsureAtomState = <Value>(atom: Atom<Value>) => AtomState<Value>;
type FlushCallbacks = () => void;
type RecomputeInvalidatedAtoms = () => void;
/** Compute an atom' state and return it. */
type ReadAtomState = <Value>(atom: Atom<Value>) => AtomState<Value>;
type InvalidateDependents = (atom: AnyAtom) => void;
type AtomRead = <Value>(
  atom: Atom<Value>,
  ...params: Parameters<Atom<Value>['read']>
) => Value;
type AtomWrite = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>,
  ...params: Parameters<WritableAtom<Value, Args, Result>['write']>
) => Result;
type AtomOnMount = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>,
  setAtom: (...args: Args) => Result
) => OnUnmount | void;
type MountAtom = <Value>(atom: Atom<Value>) => Mounted;
type UnmountAtom = <Value>(atom: Atom<Value>) => Mounted | undefined;
type WriteAtomState = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>,
  ...args: Args
) => Result;
type MountDependencies = (atom: AnyAtom) => void;

const atomRead: AtomRead = (atom, ...params) => atom.read(...params);
const atomWrite: AtomWrite = (atom, ...params) => atom.write(...params);
const atomOnMount: AtomOnMount = (atom, setAtom) => atom.onMount?.(setAtom);

export function createStore(): Store {
  return buildStore();
}

let defaultStore: Store | undefined;

export function getDefaultStore(): Store {
  if (!defaultStore) {
    defaultStore = createStore();
  }
  return defaultStore;
}

export function buildStore(
  atomStateMap: AtomStateMap = new WeakMap(),
  mountedMap: MountedMap = new WeakMap(),
  invalidatedAtoms: InvalidatedAtoms = new WeakMap(),
  changedAtoms: ChangedAtoms = new Set(),
  mountCallbacks: Callbacks = new Set(),
  unmountCallbacks: Callbacks = new Set()
): Store {
  /** Atom state getter, initializing the state if empty. */
  const ensureAtomState: EnsureAtomState = (atom) => {
    if (!atom) {
      throw new Error('Atom is undefined or null');
    }

    let atomState = atomStateMap.get(atom);
    if (!atomState) {
      atomState = {
        dependencies: new Map(),
        listeners: new Set(),
        n: 0,
      };
      atomStateMap.set(atom, atomState);
    }
    // NOTE: The `never` cast here is to tell TypeScript
    // the return value matches whatever type is expected.
    return atomState as never;
  };

  const flushCallbacks: FlushCallbacks = () => {
    const errors: unknown[] = [];
    const call = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        errors.push(e);
      }
    };
    do {
      const callbacks = new Set<() => void>();
      const add = callbacks.add.bind(callbacks);

      changedAtoms.forEach((atom) => {
        mountedMap.get(atom)?.listeners.forEach(add);
      });
      changedAtoms.clear();

      unmountCallbacks.forEach(add);
      unmountCallbacks.clear();

      mountCallbacks.forEach(add);
      mountCallbacks.clear();

      callbacks.forEach(call);

      if (changedAtoms.size) {
        recomputeInvalidatedAtoms();
      }
    } while (changedAtoms.size || unmountCallbacks.size || mountCallbacks.size);

    if (errors.length) {
      // @ts-expect-error should include type definition of `AggregateError`
      throw new AggregateError(errors);
    }
  };

  const mountDependencies: MountDependencies = (atom) => {
    const atomState = ensureAtomState(atom);
    const mounted = mountedMap.get(atom);
    if (mounted) {
      for (const [a, n] of atomState.dependencies) {
        if (!mounted.dependencies.has(a)) {
          const aState = ensureAtomState(a);
          const aMounted = mountAtom(a);
          aMounted.dependents.add(atom);
          mounted.dependencies.add(a);
          if (n !== aState.n) {
            changedAtoms.add(a);
          }
        }
      }
    }
  };

  const recomputeInvalidatedAtoms: RecomputeInvalidatedAtoms = () => {
    const topSortedReversed: [AnyAtom, AtomState][] = [];
    /** Collection of atoms whose dependents are still being processed */
    const visiting = new WeakSet<AnyAtom>();
    /** Collection of atoms whose dependents have already been processed */
    const visited = new WeakSet<AnyAtom>();
    // Visit the root atom
    const stack = Array.from(changedAtoms);
    while (stack.length) {
      const a = stack.at(stack.length - 1) as AnyAtom;
      const aState = ensureAtomState(a);
      if (visited.has(a)) {
        // All dependents have been processed,
        // now process this atom
        stack.pop();
        continue;
      }
      if (visiting.has(a)) {
        if (invalidatedAtoms.get(a) === aState.n) {
          topSortedReversed.push([a, aState]);
        } else if (invalidatedAtoms.has(a)) {
          throw new Error('invalidated atom exists');
        }
        // Atom has been visited but not yet processed
        visited.add(a);
        stack.pop();
        continue;
      }
      visiting.add(a);
      // Push unvisited dependents onto the stack
      for (const d of getMountedDependents(a, mountedMap)) {
        if (!visiting.has(d)) {
          stack.push(d);
        }
      }
    }

    // Recompute all affected atoms
    // Track what's changed, so that we can bypass unchanged deps when possible
    for (let i = topSortedReversed.length - 1; i >= 0; i--) {
      const [a, aState] = topSortedReversed[i];
      let hasChangedDeps = false;
      for (const dep of aState.dependencies.keys()) {
        if (dep !== a && changedAtoms.has(dep)) {
          hasChangedDeps = true;
          break;
        }
      }
      if (hasChangedDeps) {
        readAtomState(a);
        mountDependencies(a);
      }
      invalidatedAtoms.delete(a);
    }
  };

  const readAtomState: ReadAtomState = (atom) => {
    const atomState = ensureAtomState(atom);
    // If cached, we may skip recomputing this atom
    if (isAtomStateInitialized(atomState)) {
      // If the atom is mounted, we can use cached atom state,
      // if it has been updated by dependencies.
      if (mountedMap.has(atom) && invalidatedAtoms.get(atom) !== atomState.n) {
        return atomState;
      }
      // Otherwise, check if the dependencies have changed.
      // If all deps haven't changed, we can use the cache.
      if (
        Array.from(atomState.dependencies).every(
          ([a, n]) =>
            // Recursively, read the atom state of the dependency, and
            // check if the atom epoch number is unchanged
            readAtomState(a).n === n
        )
      ) {
        return atomState;
      }
    }
    // Compute a new state for this atom
    atomState.dependencies.clear();
    const getter: Getter = <V>(a: Atom<V>) => {
      if (isSelfAtom(atom, a)) {
        const aState = ensureAtomState(a);
        if (!isAtomStateInitialized(aState)) {
          if (hasInitialValue(a)) {
            setAtomStateValue(a, a.init, ensureAtomState);
          } else {
            // NOTE: invalid derived atoms can reach here
            throw new Error('no atom init');
          }
        }
        return returnAtomValue(aState);
      }
      // a !== atom
      const aState = ensureAtomState(a);
      try {
        return returnAtomValue(aState);
      } finally {
        atomState.dependencies.set(a, aState.n);
        // Construct the dependency relation
        mountedMap.get(a)?.dependents.add(atom);
      }
    };

    const prevEpochNumber = atomState.n;
    try {
      const value = atomRead(atom, getter);
      setAtomStateValue(atom, value, ensureAtomState);
      return atomState;
    } catch (error) {
      delete atomState.value;
      atomState.error = error;
      // Increment the epoch so that it will be marked as invalidated
      // in the `finally` block below
      ++atomState.n;
      return atomState;
    } finally {
      if (
        prevEpochNumber !== atomState.n &&
        invalidatedAtoms.get(atom) === prevEpochNumber
      ) {
        invalidatedAtoms.set(atom, atomState.n);
        changedAtoms.add(atom);
      }
    }
  };

  const invalidateDependents: InvalidateDependents = (atom) => {
    const stack: AnyAtom[] = [atom];
    while (stack.length) {
      const a = stack.pop() as AnyAtom;
      for (const d of getMountedDependents(a, mountedMap)) {
        const dState = ensureAtomState(d);
        invalidatedAtoms.set(d, dState.n);
        stack.push(d);
      }
    }
  };

  const writeAtomState: WriteAtomState = (atom, ...args) => {
    const getter: Getter = <V>(a: Atom<V>) => returnAtomValue(readAtomState(a));

    const setter: Setter = <V, As extends unknown[], R>(
      a: WritableAtom<V, As, R>,
      ...args: As
    ): R => {
      const aState = ensureAtomState(a);

      try {
        if (isSelfAtom(atom, a)) {
          if (!hasInitialValue(a)) {
            throw new Error('atom not writable');
          }
          const prevEpochNumber = aState.n;
          const v = args[0] as V;
          setAtomStateValue(a, v, ensureAtomState);
          mountDependencies(a);
          if (prevEpochNumber !== aState.n) {
            changedAtoms.add(a);
            invalidateDependents(a);
          }
          return undefined as R;
        } else {
          return writeAtomState(a, ...args);
        }
      } finally {
        // TODO: invalidate if not sync
      }
    };

    return atomWrite(atom, getter, setter, ...args);
  };

  const mountAtom: MountAtom = (atom) => {
    const atomState = ensureAtomState(atom);
    let mounted = mountedMap.get(atom);
    if (!mounted) {
      // recompute atom state
      readAtomState(atom);
      // mount dependencies first
      for (const a of atomState.dependencies.keys()) {
        const aMounted = mountAtom(a);
        aMounted.dependents.add(atom);
      }
      // mount self
      mounted = {
        listeners: new Set(),
        dependencies: new Set(atomState.dependencies.keys()),
        dependents: new Set(),
      };
      mountedMap.set(atom, mounted);
    }

    if (isActuallyWritableAtom(atom)) {
      const processOnMount = () => {
        const setAtom = (...args: unknown[]) => {
          return writeAtomState(atom, ...args);
        };

        const onUnmount = atomOnMount(atom, setAtom);
        if (onUnmount) {
          mounted.onUnmount = () => {
            onUnmount();
          };
        }
      };
      mountCallbacks.add(processOnMount);
    }

    return mounted;
  };

  const unmountAtom: UnmountAtom = (atom) => {
    const atomState = ensureAtomState(atom);
    let mounted = mountedMap.get(atom);
    if (
      mounted &&
      !mounted.listeners.size &&
      !Array.from(mounted.dependents).some((a) =>
        mountedMap.get(a)?.dependencies.has(atom)
      )
    ) {
      // unmount self
      mounted = undefined;
      mountedMap.delete(atom);
      // unmount dependencies
      for (const a of atomState.dependencies.keys()) {
        const aMounted = unmountAtom(a);
        aMounted?.dependents.delete(atom);
      }
      return undefined;
    }
    return mounted;
  };

  const store: Store = {
    get: (atom) => returnAtomValue(readAtomState(atom)),
    set: (atom, ...args) => {
      try {
        return writeAtomState(atom, ...args);
      } finally {
        recomputeInvalidatedAtoms();
        flushCallbacks();
      }
    },
    sub: (atom, listener) => {
      const mounted = mountAtom(atom);
      const listeners = mounted.listeners;
      listeners.add(listener);
      flushCallbacks();
      return () => {
        listeners.delete(listener);
        unmountAtom(atom);
        flushCallbacks();
      };
    },
  };

  return store;
}

function getMountedDependents(
  atom: AnyAtom,
  mountedMap: MountedMap
): Set<AnyAtom> {
  const dependents = new Set<AnyAtom>();
  for (const a of mountedMap.get(atom)?.dependents ?? []) {
    if (mountedMap.has(a)) {
      dependents.add(a);
    }
  }
  return dependents;
}

function setAtomStateValue(
  atom: AnyAtom,
  value: unknown,
  ensureAtomState: EnsureAtomState
) {
  const atomState = ensureAtomState(atom);
  const hasPrevValue = 'value' in atomState;
  const prevValue = atomState.value;
  atomState.value = value;
  delete atomState.error;
  if (!hasPrevValue || !Object.is(prevValue, atomState.value)) {
    ++atomState.n;
  }
}
