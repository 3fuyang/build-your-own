// [x] Store & Provider API (Provider-less mode)
// [] Async atoms (Suspense integration, abortable)
// [] Atom utils like persistency (w/ Client storage)
// [] Resettable

import type { OnMount } from "./internals";

/**
 * Meta description of an atom, which itself does not hold a value.
 */
export interface Atom<Value> {
  read: Read<Value>;
}

/**
 * Read atom values, and track the dependencies if needed.
 *
 * Note: Getter is not generic, so is the setter below.
 */
export type Getter = <Value>(atom: Atom<Value>) => Value;

/**
 * Write into atoms
 */
export type Setter = <Value, Args extends unknown[], Result>(
  atom: WritableAtom<Value, Args, Result>,
  ...args: Args
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

export interface WritableAtom<Value, Args extends unknown[], Result>
  extends Atom<Value> {
  write: Write<Args, Result>;
  onMount?: OnMount<Args, Result>
}

type SetStateAction<Value> = Value | ((prev: Value) => Value);

type PrimitiveAtom<Value> = WritableAtom<Value, [SetStateAction<Value>], void>;

interface WithInitialValue<Value> {
  init: Value;
};

/**
 * Below are various overloads of atom constructor
 */

// primitive atom without initial value
export function atom<Value>(): PrimitiveAtom<Value | undefined> &
  WithInitialValue<Value | undefined>;

// primitive atom
export function atom<Value>(
  init: Value
): PrimitiveAtom<Value> & WithInitialValue<Value>;

// writable derived atom
export function atom<Value, Args extends unknown[], Result>(
  read: Read<Value>,
  write: Write<Args, Result>
): WritableAtom<Value, Args, Result>;

// read-only derived atom
export function atom<Value>(read: Read<Value>): Atom<Value>;

// write-only derived atom
export function atom<Value, Args extends unknown[], Result>(
  init: Value,
  write: Write<Args, Result>
): WritableAtom<null, Args, Result> & WithInitialValue<Value>;

export function atom<Value, Args extends unknown[], Result>(
  read?: Value | Read<Value>,
  write?: Write<Args, Result>
) {
  const config = {} as WritableAtom<Value, Args, Result> &
    WithInitialValue<Value | undefined>;

  if (typeof read === 'function') {
    // Derived atoms
    config.read = read as Read<Value>;
  } else {
    // Primitive atom or write-only derived atom
    config.init = read;
    config.read = defaultRead;
    config.write = write ?? (defaultWrite as unknown as Write<Args, Result>);
  }
  if (write) {
    // Writable derived atom
    config.write = write;
  }
  return config;
}

function defaultRead<Value>(this: Atom<Value>, get: Getter) {
  return get(this);
}

function defaultWrite<Value>(
  this: PrimitiveAtom<Value>,
  get: Getter,
  set: Setter,
  arg: SetStateAction<Value>
) {
  return set(
    this,
    typeof arg === 'function' ? (arg as (prev: Value) => Value)(get(this)) : arg
  );
}
