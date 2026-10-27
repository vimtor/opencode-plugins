// Session metadata `tab: false` keeps a session from opening when it's created; setting `tab: true` later opens it.
export const tab = (metadata: { readonly [key: string]: unknown } | undefined) => metadata?.tab
