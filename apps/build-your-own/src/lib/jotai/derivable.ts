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
// import { useEffect, useState } from 'react';

/**
 * Meta description of an atom, which itself does not hold a value.
 */
interface AtomConfig<Value> {
  read: Read<Value>;
}

/**
 * Read atom values, and track the dependencies if needed.
 *
 * Note: Getter is not generic, so is the setter below.
 */
type Getter = <Value>(atom: AtomConfig<Value>) => Value;

/**
 * Write into atoms
 */
type Setter = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>
) => Result;

/**
 * User provided reader function
 */
type Read<Value> = (get: Getter) => Value;

/**
 * User provided writer function
 */
type Write<Args extends unknown[], Result> = (
  get: Getter,
  set: Setter,
  ...args: Args
) => Result;

interface WritableAtom<Value, Args extends unknown[], Result>
  extends AtomConfig<Value> {
  Write: Write<Args, Result>;
}

type SetStateAction<Value> = Value | ((prev: Value) => Value);

type PrimitiveAtom<Value> = WritableAtom<Value, [SetStateAction<Value>], void>;

// /**
//  * Creates an atom config
//  */
// export function atom<Value, Args extends unknown[], Result>(
//   read?: Value | AtomConfig<Value>['read'],
//   write?: AtomConfig<Value, Args, Result>['write']
// ): AtomConfig<Value, Args, Result> {
//   if (typeof read === 'function') {
//     return {
//       read: read as (
//         get: <SomeValue>(atom: AtomConfig<SomeValue>) => SomeValue
//       ) => Value,
//       write,
//     };
//   }

//   const defaultWrite = ((
//     get: <SomeValue, SomeArgs extends unknown[], SomeResult>(
//       atom: AtomConfig<SomeValue, SomeArgs, SomeResult>
//     ) => SomeValue,
//     set: <SomeValue, SomeArgs extends unknown[], SomeResult>(
//       atom: AtomConfig<SomeValue, SomeArgs, SomeResult>,
//       nextValue: SomeValue
//     ) => Result,
//     arg: Value | ((value: Value) => Value)
//   ) => {
//     if (typeof arg === 'function') {
//       const prevValue = get(config);
//       return set(config, (arg as (prevValue: Value) => Value)(prevValue));
//     } else {
//       return set(config, arg as Value);
//     }
//   }) as unknown as AtomConfig<Value, Args, Result>['write'];

//   const config: AtomConfig<Value, Args, Result> = {
//     init: read,

//     read: (get) => get(config),

//     write: write ?? defaultWrite,
//   };

//   return config;
// }

// interface AtomState<Value = unknown> {
//   value: Value | undefined;
//   /**
//    * Basically React state setters
//    */
//   listeners: Set<() => void>;
//   dependents: Set<AtomConfig>;
// }

// const atomStateMap = new WeakMap<AtomConfig, AtomState>();
// const getAtomState = <Value, Args extends unknown[], Result>(
//   atom: AtomConfig<Value, Args, Result>
// ) => {
//   let atomState = atomStateMap.get(atom as AtomConfig<unknown>) as
//     | AtomState<Value>
//     | undefined;
//   if (!atomState) {
//     atomState = {
//       value: atom.init,
//       listeners: new Set(),
//       dependents: new Set(),
//     };
//     atomStateMap.set(atom as AtomConfig, atomState);
//   }
//   return atomState;
// };

// /**
//  * Only gets called on mount.
//  */
// const readAtom = <Value, Args extends unknown[], Result>(
//   atom: AtomConfig<Value, Args, Result>
// ) => {
//   const atomState = getAtomState(atom);
//   /**
//    * NOTE: The `get` in `readAtom` tracks the dependent atoms for the
//    * referenced atom. So when we explicitly calls `get` to read referenced
//    * atoms, we are actually constructing the dependency.
//    */
//   const get = <SomeValue, SomeArgs extends unknown[], SomeResult>(
//     a: AtomConfig<SomeValue, SomeArgs, SomeResult>
//   ): SomeValue => {
//     type SomeAtom = AtomConfig;
//     if ((a as SomeAtom) === (atom as SomeAtom)) {
//       return atomState.value as SomeValue;
//     }

//     const aState = getAtomState(a);

//     // track dependents
//     aState.dependents.add(atom as SomeAtom);
//     // now read the actual value
//     return readAtom(a);
//   };
//   const value = atom.read(get);
//   atomState.value = value;
//   return value;
// };

// /**
//  * Encapsulated update function, which involves
//  * notifying dependents and listeners (in effect).
//  */
// const notify = <Value, Args extends unknown[], Result>(
//   atom: AtomConfig<Value, Args, Result>
// ) => {
//   const atomState = getAtomState(atom);
//   atomState.dependents.forEach((d) => {
//     if (d !== atom) {
//       notify(d);
//     }
//   });
//   atomState.listeners.forEach((l) => l());
// };

// const writeAtom = <Value, Args extends unknown[], Result>(
//   atom: AtomConfig<Value, Args, Result>,
//   arg: Args
// ): Result => {
//   const atomState = getAtomState(atom);

//   /**
//    * NOTE: dose not track dependents here
//    */
//   const get = <SomeValue, SomeArgs extends unknown[], SomeResult>(
//     a: AtomConfig<SomeValue, SomeArgs, SomeResult>
//   ) => {
//     const aState = getAtomState(a);
//     return aState.value as SomeValue;
//   };

//   const set = <SomeValue, SomeArgs extends unknown[], SomeResult>(
//     a: AtomConfig<SomeValue, SomeArgs, SomeResult>,
//     arg: SomeArgs
//   ): SomeResult => {
//     type SomeAtom = AtomConfig;
//     if ((a as SomeAtom) === (atom as SomeAtom)) {
//       atomState.value = arg as unknown as Value;
//       notify(atom);
//     }
//     return writeAtom(a, arg);
//   };

//   // Writable atoms must have `write()` method
//   return (atom.write as NonNullable<AtomConfig<Value, Args, Result>['write']>)(
//     get,
//     set,
//     arg
//   );
// };

// // Like `useState`, returns a tuple of the current value
// // and an updater function
// export const useAtom = <Value, Args extends unknown[], Result>(
//   atom: AtomConfig<Value, Args, Result>
// ) => {
//   const [value, setValue] = useState<Value>();

//   useEffect(
//     () => {
//       const callback = () => setValue(readAtom(atom));
//       const atomState = getAtomState(atom);
//       // listens to updates to the atom
//       // from other components
//       atomState.listeners.add(callback);
//       // NOTE: This is for during the mount time,
//       // `atom.value` could be changed before the effect fires.
//       callback();

//       return () => {
//         atomState.listeners.delete(callback);
//       };
//     },
//     // NOTE: Putting the whole `atomState` here is to support
//     // conditional atoms.
//     [atom]
//   );

//   const setAtom = (args: Args) => {
//     return writeAtom(atom, args);
//   };

//   return [value, setAtom] as const;
// };
