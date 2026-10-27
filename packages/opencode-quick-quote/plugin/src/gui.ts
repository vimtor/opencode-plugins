import { Command, Plugin } from "@opencode/plugin/gui"
import { filterParagraphs, latestReplies, paragraphs } from "./quotes.js"

export default Plugin.define({
  setup(ctx) {
    async function quote(query: string) {
      const session = ctx.sessions.current()
      const composer = ctx.screen.current()?.composer
      if (!session || !composer) {
        ctx.toast.show({ title: "Start a session." })
        return
      }
      if (!composer.quotable()) {
        ctx.toast.show({ title: "This prompt can't take quotes." })
        return
      }

      const data = session.server.data
      await data.session.message.sync(session.id)
      const items = latestReplies(data.session.message.list(session.id)).flatMap(paragraphs)
      const matches = filterParagraphs(items, query)
      if (matches.length === 0) {
        ctx.toast.show({ title: items.length ? "No matching paragraphs." : "No reply to quote yet." })
        return
      }

      const paragraph = await ctx.dialogs.select({
        title: "Quote",
        placeholder: "Search paragraphs in the last reply",
        options: matches.map((text) => ({ title: text.replace(/\s+/g, " ").trim(), value: text })),
      })
      // The composer follows the route, so drop the quote if the user moved to another session.
      if (paragraph === undefined || ctx.sessions.current()?.key !== session.key) return
      const commentID = crypto.randomUUID()
      composer.attach({
        type: "quote",
        commentID,
        text: paragraph,
        source: { label: "Reply", icon: "outline-quote", subject: "the assistant's reply" },
      })
      composer.focus(commentID)
    }

    ctx.add(Command, {
      id: "quote",
      title: "Quote the last reply",
      keywords: "quote paragraph reply",
      slash: { name: "quote", arguments: true },
      run: (query) =>
        quote(query?.trim() ?? "").catch(() => {
          ctx.toast.show({ variant: "error", title: "Could not load the last reply." })
        }),
    })
  },
})
