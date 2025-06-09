import type { Atom, Getter, Setter, WritableAtom } from './atom';

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
 * Mutable atom state,
 * tracked for both mounted and unmounted atoms in a store.
 *
 * Should be garbage collectable.
 */
export interface AtomState<Value = AnyValue> {
  value?: Value;
  error?: AnyError;
  /** Set of listeners to notify when the atom value changes. */
  readonly listeners: Set<() => void>;
  /** Map of atoms that the atom depends on. */
  readonly dependencies: Map<AnyAtom, EpochNumber>;
  /**
   * The epoch-like number of the atom (does nothing with the `Date` stuff),
   * functioning like a **version number**.
   */
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

type UnSub = () => void;
type Sub = (atom: AnyAtom, listener: () => void) => UnSub;

export interface Store {
  get: <Value>(atom: Atom<Value>) => Value;
  set: <Value, Args extends unknown[], Result>(
    atom: WritableAtom<Value, Args, Result>,
    ...args: Args
  ) => Result;
  sub: Sub;
}

//
// Below interfaces are literally `Map`s or `Set`s,
// exposing only restricted APIs for better abstraction.
//

/**
 * WeakMap of atom states (value, listeners, dependencies, etc.) in a specific store.
 */
interface AtomStateMap {
  get(atom: AnyAtom): AtomState | undefined;
  set(atom: AnyAtom, atomState: AtomState): void;
}

/**
 * WeakMap of atom states that are mounted (has a dependent)
 */
interface MountedMap {
  get(atom: AnyAtom): Mounted | undefined;
  has(atom: AnyAtom): boolean;
  set(atom: AnyAtom, mounted: Mounted): void;
  delete(atom: AnyAtom): void;
}

/**
 * Map which tracks atoms that are stale and need to be recomputed,
 * also storing their `n` for comparison.
 */
type InvalidatedAtoms = {
  get(atom: AnyAtom): EpochNumber | undefined;
  has(atom: AnyAtom): boolean;
  set(atom: AnyAtom, n: EpochNumber): void;
  delete(atom: AnyAtom): void;
};

/**
 * Set which tracks atoms that have changed during the current update cycle,
 * so that we could propagate the updates to dependents and execute listeners, etc.
 */
interface ChangedAtoms {
  readonly size: number;
  add(atom: AnyAtom): void;
  has(atom: AnyAtom): boolean;
  clear(): void;
  forEach(callback: (atom: AnyAtom) => void): void;
  [Symbol.iterator](): IterableIterator<AnyAtom>;
}

/**
 * Set of OnMount or OnUnmount callbacks,
 * also cleared after execution.
 */
interface Callbacks {
  readonly size: number;
  add(fn: () => void): void;
  clear(): void;
  forEach(callback: (fn: () => void) => void): void;
}

type EnsureAtomState = <Value>(atom: Atom<Value>) => AtomState<Value>;
type FlushCallbacks = () => void;
type RecomputeInvalidatedAtoms = () => void;
/** Compute an atom's state and return it. */
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

export function buildStore(
  atomStateMap: AtomStateMap = new WeakMap(),
  mountedMap: MountedMap = new WeakMap(),
  invalidatedAtoms: InvalidatedAtoms = new WeakMap(),
  changedAtoms: ChangedAtoms = new Set(),
  mountCallbacks: Callbacks = new Set(),
  unmountCallbacks: Callbacks = new Set()
): Store {
  /** Atom state getter, initializing the state in the map if needed. */
  const ensureAtomState: EnsureAtomState = (atom) => {
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
      /**
       * The purpose of this bound `add` is to be passed to `forEach`,
       * and stays intact from other parameters passed by `forEach`
       * to the callback.
       */
      const add = callbacks.add.bind(callbacks);

      // Enqueue listeners of changed atoms,
      // usually React state dispatchers.
      changedAtoms.forEach((atom) => {
        mountedMap.get(atom)?.listeners.forEach(add);
      });
      changedAtoms.clear();

      // First `onUnmount` callbacks
      unmountCallbacks.forEach(add);
      unmountCallbacks.clear();

      // Then `onMount` callbacks
      mountCallbacks.forEach(add);
      mountCallbacks.clear();

      // Now execute all of them!
      callbacks.forEach(call);

      // This checks if any atoms were marked as "changed"
      // during the callback execution above, sort of a recursive process.
      if (changedAtoms.size) {
        recomputeInvalidatedAtoms();
      }
    } while (changedAtoms.size || unmountCallbacks.size || mountCallbacks.size);

    if (errors.length) {
      // @ts-expect-error should include type definition of `AggregateError`
      throw new AggregateError(errors);
    }
  };

  /**
   * Iterates an atom's dependencies and mount them and tracks the dependency
   * if they are not mounted yet.
   */
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

    // Recompute all affected atoms.
    // Track what's changed, so that we can bypass unchanged deps when possible.
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
      // NOTE: If an atom's current `n` doesn't match its invalidate `n`,
      // it means the atom has been updated since invalidation.
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

    // If not initialized, compute a new state for this atom,
    // clearing the stale dependencies first.
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
      /**
       * Mark atom as changed if:
       * 1. `n` changes from the previous one, meaning the atom is changed
       * 2. Previous `n` matches the invalidated one's, meaning the value is stale
       */
      const shouldInvalidate =
        prevEpochNumber !== atomState.n &&
        invalidatedAtoms.get(atom) === prevEpochNumber;
      if (shouldInvalidate) {
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
      // recompute atom state,
      // the dependencies are tracked during it
      readAtomState(atom);
      // Mount all the referenced atoms recursively first (since this atom is relying on them),
      // and register the atom as a dependent on them
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

    // Register `onMount` callbacks, which will optionally return
    // an `onUnmount` callback during execution.
    if (isActuallyWritableAtom(atom)) {
      /** Just a callback, not executing right now. */
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

  /**
   * **Attempt** to unmount an atom,
   * but will certainly not proceed
   * if it still got dependents.
   * @returns `undefined` if successfully unmounted; the mounted atom if it's still being referenced.
   */
  const unmountAtom: UnmountAtom = (atom) => {
    const atomState = ensureAtomState(atom);
    let mounted = mountedMap.get(atom);
    const shouldUnmount =
      mounted &&
      !mounted.listeners.size &&
      !Array.from(mounted.dependents).some((a) =>
        mountedMap.get(a)?.dependencies.has(atom)
      );
    if (shouldUnmount) {
      // unmount self
      mounted = undefined;
      mountedMap.delete(atom);
      // unmount dependencies recursively
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

/**
 * @returns `true` if the atom is created with a `write` function
 */
export function isActuallyWritableAtom(atom: AnyAtom): atom is AnyWritableAtom {
  return !!(atom as AnyWritableAtom).write;
}
