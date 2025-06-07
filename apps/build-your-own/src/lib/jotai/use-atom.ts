import { useCallback, useEffect, useReducer } from 'react';

import type { Atom, Getter, Setter, WritableAtom } from './atom';
import {
  hasInitialValue,
  isAtomStateInitialized,
  isSelfAtom,
  type AnyAtom,
  type AtomState,
} from './internals';

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
      if (!isAtomStateInitialized(atomState) && hasInitialValue(atom)) {
        return atom.init as unknown as V;
      }
      return atomState.value as V;
    }
    const aState = readAtomState(a);
    aState.dependents.add(atom);
    return aState.value as V;
  };

  // Calls user provided read function here,
  // calculating the value and assigning it to the atom state
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

/**
 * Write into an atom and notify all its observers
 */
function writeAtomState<Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>,
  ...args: Args
): Result {
  const getter: Getter = <V>(a: Atom<V>) => readAtomState(a).value as V;
  const setter: Setter = <V, As extends unknown[], R>(
    a: WritableAtom<V, As, R>,
    ...args: As
  ) => {
    const aState = ensureAtomState(a);
    if (isSelfAtom(atom, a)) {
      const v = args[0] as V;
      aState.value = v;
      notify(a);

      return undefined as R;
    }
    return writeAtomState(a, ...args);
  };

  return atom.write(getter, setter, ...args);
}

/**
 * Notify all the dependent atoms, run callbacks for all
 * the components that are dependent on this atom.
 *
 * NOTE: In actual implementation, it's implemented by
 * `mountDependencies`, maybe.
 */
function notify(atom: AnyAtom) {
  const atomState = ensureAtomState(atom);
  for (const a of atomState.dependents) {
    notify(a);
  }
  for (const l of atomState.listeners) {
    l();
  }
}

/**
 * The real `useAtom` actually has many overloads for better ergonomics.
 * @see https://newsletter.daishikato.com/p/how-jotai-hooks-use-function-overload-in-typescript
 */
export function useAtom<Value, Args extends unknown[], Result>(
  atom: Atom<Value> | WritableAtom<Value, Args, Result>
) {
  return [
    useAtomValue(atom),
    useSetAtom(atom as WritableAtom<Value, Args, Result>),
  ] as const;
}

export function useAtomValue<Value>(atom: Atom<Value>): Value {
  const [[valueFromReducer, atomFromReducer], rerender] = useReducer<
    readonly [Value, typeof atom],
    undefined,
    []
  >(
    (prev) => {
      const atomState = readAtomState(atom);
      const nextValue = atomState.value;

      if (Object.is(nextValue, prev[0]) && prev[1] === atom) {
        return prev;
      }

      return [nextValue as Value, atom];
    },
    undefined,
    () => [readAtomState(atom).value as Value, atom]
  );

  let value = valueFromReducer;
  if (atomFromReducer !== atom) {
    rerender();
    value = readAtomState(atom).value as Value;
  }

  useEffect(() => {
    // subscribe
    const atomState = readAtomState(atom);
    atomState.listeners.add(rerender);

    rerender();

    // unsubscribe
    return () => {
      atomState.listeners.delete(rerender);
    };
  }, [atom]);

  return value;
}

function useSetAtom<Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>
) {
  const setAtom = useCallback(
    (...args: Args) => {
      return writeAtomState(atom, ...args);
    },
    [atom]
  );

  return setAtom;
}
