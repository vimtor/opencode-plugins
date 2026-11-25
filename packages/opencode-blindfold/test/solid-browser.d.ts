// The browser builds are resolved by path in gui.test.ts; their package export
// does not carry a declaration file for the deep import.
declare module "solid-js/dist/solid.js" {
  export * from "solid-js"
}

declare module "solid-js/store/dist/store.js" {
  export * from "solid-js/store"
}
