// Declaration:
// const userAtom = atom({ id: 'bar', username: 'foo' })
// Usage:
// // Inside a component
// const user = useAtomValue(userAtom)

import { useEffect, useState } from 'react';

interface Atom<T = unknown> {
  init: T;
}

export const atom = <T>(initialValue: T): Atom<T> => ({ init: initialValue });

interface AtomState<T = unknown> {
  value: T;
  listeners: Set<() => void>;
}

const atomStateMap = new WeakMap<Atom, AtomState>();
const getAtomState = <T>(atom: Atom<T>) => {
  let atomState = atomStateMap.get(atom) as AtomState<T> | undefined;
  if (!atomState) {
    atomState = { value: atom.init, listeners: new Set() };
    atomStateMap.set(atom, atomState);
  }
  return atomState;
};

// Like `useState`, returns a tuple of the current value
// and an updater function
export const useAtom = <T>(atom: Atom<T>) => {
  const atomState = getAtomState(atom);
  const [value, setValue] = useState(atomState.value);

  useEffect(() => {
    const callback = () => setValue(atomState.value);

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
  [atomState]);

  const setAtom = (nextValue: T) => {
    atomState.value = nextValue;

    // notify listeners that the atom state has changed
    atomState.listeners.forEach((l) => l());
  };

  return [value, setAtom] as const;
};
