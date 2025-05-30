// Declaration:
// const priceAtom = atom(10)
// const readOnlyAtom = atom((get) => get(priceAtom) * 2)
// const writeOnlyAtom = atom(
//   null,
//   (get, set, args) => {
//     set(priceAtom, get(priceAtom) - args)
//   },
// )
// const readWriteAtom = atom(
//   (get) => get(priceAtom) * 2,
//   (get, set, newPrice) => {
//     set(priceAtom, newPrice / 2)
//   },
// )
import { useEffect, useState } from 'react';

/**
 * Meta description of an atom
 */
interface AtomConfig<Value = unknown> {
  init?: Value;
  read: (get: <SomeValue>(atom: AtomConfig<SomeValue>) => SomeValue) => Value;
  write?: (
    get: <SomeValue>(atom: AtomConfig<SomeValue>) => SomeValue,
    set: <SomeValue>(atom: AtomConfig<SomeValue>, nextValue: SomeValue) => void,
    arg: Value | ((prevValue: Value) => Value)
  ) => void;
}

/**
 * Creates an atom config
 */
export function atom<Value>(
  read?: Value | AtomConfig<Value>['read'],
  write?: AtomConfig<Value>['write']
): AtomConfig<Value> {
  if (typeof read === 'function') {
    return {
      read: read as (
        get: <SomeValue>(atom: AtomConfig<SomeValue>) => SomeValue
      ) => Value,
      write,
    };
  }

  const config: AtomConfig<Value> = {
    init: read,

    read: (get) => get(config),

    write:
      write ??
      ((get, set, arg) => {
        if (typeof arg === 'function') {
          const prevValue = get(config);
          set(config, (arg as (prevValue: Value) => Value)(prevValue));
        } else {
          set(config, arg);
        }
      }),
  };

  return config;
}

interface AtomState<Value = unknown> {
  value: Value | undefined;
  listeners: Set<() => void>;
  dependents: Set<AtomConfig>;
}

const atomStateMap = new WeakMap<AtomConfig, AtomState>();
const getAtomState = <Value>(atom: AtomConfig<Value>) => {
  let atomState = atomStateMap.get(atom as AtomConfig<unknown>) as
    | AtomState<Value>
    | undefined;
  if (!atomState) {
    atomState = {
      value: atom.init,
      listeners: new Set(),
      dependents: new Set(),
    };
    atomStateMap.set(atom as AtomConfig, atomState);
  }
  return atomState;
};

/**
 * Only gets called on mount.
 */
const readAtom = <Value>(atom: AtomConfig<Value>) => {
  const atomState = getAtomState(atom);
  /**
   * NOTE: The `get` in `readAtom` tracks the dependent atoms for the
   * referenced atom. So when we explicitly calls `get` to read referenced
   * atoms, we are actually constructing the dependency.
   */
  const get = <SomeValue>(a: AtomConfig<SomeValue>): SomeValue => {
    type SomeAtom = AtomConfig;
    if ((a as SomeAtom) === (atom as SomeAtom)) {
      return atomState.value as SomeValue;
    }

    const aState = getAtomState(a);

    // track dependents
    aState.dependents.add(atom as SomeAtom);
    // now read the actual value
    return readAtom(a);
  };
  const value = atom.read(get);
  atomState.value = value;
  return value;
};

/**
 * Encapsulated update function, which involves
 * notifying dependents and listeners (in effect).
 */
const notify = <Value>(atom: AtomConfig<Value>) => {
  const atomState = getAtomState(atom);
  atomState.dependents.forEach((d) => {
    if (d !== atom) {
      notify(d);
    }
  });
  atomState.listeners.forEach((l) => l());
};

const writeAtom = <Value>(atom: AtomConfig<Value>, nextValue: Value) => {
  const atomState = getAtomState(atom);

  /**
   * NOTE: dose not track dependents here
   */
  const get = <SomeValue>(a: AtomConfig<SomeValue>) => {
    const aState = getAtomState(a);
    return aState.value as SomeValue;
  };

  const set = <SomeValue>(a: AtomConfig<SomeValue>, v: SomeValue) => {
    type SomeAtom = AtomConfig;
    if ((a as SomeAtom) === (atom as SomeAtom)) {
      atomState.value = v as unknown as Value;
      notify(atom);
      return;
    }
    writeAtom(a, v);
  };

  atom.write?.(get, set, nextValue);
};

// Like `useState`, returns a tuple of the current value
// and an updater function
export const useAtom = <T>(atom: AtomConfig<T>) => {
  const [value, setValue] = useState<T>();

  useEffect(
    () => {
      const callback = () => setValue(readAtom(atom));
      const atomState = getAtomState(atom);
      // listens to updates to the atom
      // from other components
      atomState.listeners.add(callback);
      // NOTE: This is for during the mount time,
      // `atom.value` could be changed before the effect fires.
      callback();

      return () => {
        atomState.listeners.delete(callback);
      };
    },
    // NOTE: Putting the whole `atomState` here is to support
    // conditional atoms.
    [atom]
  );

  const setAtom = (nextValue: T) => {
    writeAtom(atom, nextValue);
  };

  return [value, setAtom] as const;
};
