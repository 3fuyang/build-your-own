import type { Atom, Getter, Setter, WritableAtom } from './atom';
import {
  hasInitialValue,
  isAtomStateInitialized,
  isSelfAtom,
  returnAtomValue,
  type AnyAtom,
  type AtomState,
  type Mounted,
} from './internals';

interface Store {
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
type ReadAtomState = <Value>(atom: Atom<Value>) => AtomState<Value>;
type AtomRead = <Value>(
  atom: Atom<Value>,
  ...params: Parameters<Atom<Value>['read']>
) => Value;
type AtomWrite = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>,
  ...params: Parameters<WritableAtom<Value, Args, Result>['write']>
) => Result;
type MountAtom = <Value>(atom: Atom<Value>) => Mounted;

type WriteAtomState = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>,
  ...args: Args
) => Result;

export function buildStore(
  atomStateMap: AtomStateMap = new WeakMap(),
  mountedMap: MountedMap = new WeakMap(),
  changedAtoms: ChangedAtoms = new Set(),
  mountCallbacks: Callbacks = new Set(),
  unmountCallbacks: Callbacks = new Set()
): Store {
  const ensureAtomState: EnsureAtomState = (atom) => {
    if (!atom) {
      throw new Error('Atom is undefined or null');
    }

    let atomState = atomStateMap.get(atom);
    if (!atomState) {
      atomState = {
        dependencies: new Set(),
        listeners: new Set(),
      };
      atomStateMap.set(atom, atomState);
    }
    // NOTE: The `never` cast here is to tell TypeScript
    // the return value matches whatever type is expected.
    return atomState as never;
  };

  const atomRead: AtomRead = (atom, ...params) => atom.read(...params);
  const atomWrite: AtomWrite = (atom, ...params) => atom.write(...params);

  const readAtomState: ReadAtomState = (atom) => {
    const atomState = ensureAtomState(atom);
    // if atom cached
    if (isAtomStateInitialized(atomState)) {
      return atomState;
    }
    // compute a new state for this atom
    atomState.dependencies.clear();
    const getter: Getter = <V>(a: Atom<V>) => {
      if (isSelfAtom(atom, a)) {
        const aState = ensureAtomState(a);
        if (!isAtomStateInitialized(aState)) {
          if (hasInitialValue(a)) {
            aState.value = a.init as V;
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
        atomState.dependencies.add(a);
      }
    };

    try {
      const value = atomRead(atom, getter);
      delete atomState.error;
      atomState.value = value;
      return atomState;
    } catch (error) {
      delete atomState.value;
      atomState.error = error;
      return atomState;
    } finally {
      // TODO: invalidation related
    }
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
        // recompute invalidated atoms
      }
    } while (changedAtoms.size || unmountCallbacks.size || mountCallbacks.size);

    if (errors.length) {
      // @ts-expect-error should include type definition of `AggregateError`
      throw new AggregateError(errors);
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
          const v = args[0] as V;
          aState.value = v;
          delete aState.error;
          return undefined as R;
        } else {
          return writeAtomState(a, ...args);
        }
      } finally {
        // TODO: invalidate
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
      for (const a of atomState.dependencies) {
        const aMounted = mountAtom(a);
        aMounted.dependents.add(atom);
      }
      // mount self
      mounted = {
        listeners: new Set(),
        dependencies: new Set(atomState.dependencies),
        dependents: new Set(),
      };
      mountedMap.set(atom, mounted);
    }

    return mounted;
  };

  const store: Store = {
    get: (atom) => returnAtomValue(readAtomState(atom)),
    set: (atom, ...args) => {
      try {
        return writeAtomState(atom, ...args);
      } finally {
        // TODO: invalidation
      }
    },
    sub: (atom, listener) => {
      const mounted = mountAtom(atom);
      const listeners = mounted.listeners;
      listeners.add(listener);
      flushCallbacks();
      return () => {
        listeners.delete(listener);
        // TODO: unmount atom
        flushCallbacks();
      };
    },
  };

  return store;
}
