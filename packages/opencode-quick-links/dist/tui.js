import { Plugin } from "@opencode/plugin/tui";
import open from "open";
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[\],.;:!?}*]+$/;
function trimLink(url) {
    let depth = 0;
    for (let index = 0; index < url.length; index++) {
        if (url[index] === "(")
            depth++;
        if (url[index] !== ")")
            continue;
        if (depth === 0)
            return url.slice(0, index).replace(TRAILING_PUNCTUATION, "");
        depth--;
    }
    return url.replace(TRAILING_PUNCTUATION, "");
}
function extractLinks(messages) {
    const seen = new Set();
    const links = [];
    for (const message of messages) {
        const texts = message.type === "user"
            ? [message.text]
            : message.type === "assistant"
                ? message.content.flatMap((part) => part.type === "text" ? [part.text] : [])
                : [];
        for (const text of texts) {
            for (const match of text.matchAll(URL_PATTERN)) {
                const candidate = trimLink(match[0]);
                let url;
                try {
                    const parsed = new URL(candidate);
                    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
                        continue;
                    url = parsed.href;
                }
                catch {
                    continue;
                }
                if (seen.has(url))
                    continue;
                seen.add(url);
                links.push({ url });
            }
        }
    }
    return links;
}
export default Plugin.define({
    id: "opencode-quick-links",
    setup(ctx) {
        async function showQuickLinks() {
            const route = ctx.ui.router.current();
            if (route.type !== "session") {
                ctx.ui.toast.show({ variant: "warning", message: "Start a session." });
                return;
            }
            await ctx.data.session.message.sync(route.sessionID);
            const links = extractLinks(ctx.data.session.message.list(route.sessionID));
            if (links.length === 0) {
                ctx.ui.toast.show({ variant: "info", message: "No links found in this session." });
                return;
            }
            const url = await ctx.ui.dialog.select({
                title: "Quick Links",
                placeholder: "Search links",
                options: links.map((link) => ({ title: link.url, value: link.url })),
            });
            if (!url)
                return;
            await open(url).catch(() => {
                ctx.ui.toast.show({ variant: "warning", title: "Could not open browser", message: url });
            });
        }
        return ctx.ui.slot({
            append: "app",
            render() {
                ctx.keymap.layer(() => ({
                    mode: "global",
                    commands: [
                        {
                            id: "quick-links.open",
                            title: "Open session links",
                            group: "Plugin",
                            palette: true,
                            slash: { name: "links" },
                            run: () => showQuickLinks().catch(() => {
                                ctx.ui.toast.show({ variant: "error", message: "Could not load session links." });
                            }),
                        },
                    ],
                    bindings: ["quick-links.open"],
                }));
                return null;
            },
        });
    },
});
//# sourceMappingURL=tui.js.map