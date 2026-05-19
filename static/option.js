export const OPTION = {
    SOME: "some",
    NONE: "none",
};
export const RESULT = {
    OK: "ok",
    ERR: "err",
};
export function some(value) {
    return { type: OPTION.SOME, value };
}
export function none() {
    return { type: OPTION.NONE };
}
export function ok(value) {
    return { type: RESULT.OK, value };
}
export function err(error) {
    return { type: RESULT.ERR, error };
}
export function isSome(option) {
    return option.type === OPTION.SOME;
}
export function isOk(result) {
    return result.type === RESULT.OK;
}
export function optionValueOr(option, fallback) {
    return isSome(option) ? option.value : fallback;
}
export function optionMap(option, map) {
    return isSome(option) ? some(map(option.value)) : none();
}
