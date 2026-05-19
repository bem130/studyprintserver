export const OPTION = {
  SOME: "some",
  NONE: "none",
} as const;

export const RESULT = {
  OK: "ok",
  ERR: "err",
} as const;

export interface Some<T> {
  type: typeof OPTION.SOME;
  value: T;
}

export interface None {
  type: typeof OPTION.NONE;
}

export type Option<T> = Some<T> | None;

export interface Ok<T> {
  type: typeof RESULT.OK;
  value: T;
}

export interface Err<E> {
  type: typeof RESULT.ERR;
  error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function some<T>(value: T): Option<T> {
  return { type: OPTION.SOME, value };
}

export function none<T>(): Option<T> {
  return { type: OPTION.NONE };
}

export function ok<T, E>(value: T): Result<T, E> {
  return { type: RESULT.OK, value };
}

export function err<T, E>(error: E): Result<T, E> {
  return { type: RESULT.ERR, error };
}

export function isSome<T>(option: Option<T>): option is Some<T> {
  return option.type === OPTION.SOME;
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.type === RESULT.OK;
}

export function optionValueOr<T>(option: Option<T>, fallback: T): T {
  return isSome(option) ? option.value : fallback;
}

export function optionMap<T, U>(option: Option<T>, map: (value: T) => U): Option<U> {
  return isSome(option) ? some(map(option.value)) : none();
}
