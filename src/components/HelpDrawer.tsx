import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { getHelpArticle } from "../help/articles";

// A small "?" button that side-loads an explainer for a card/metric into a
// right-side drawer (slide-in, not a navigation — chart state is preserved).
// Self-contained: each button owns its own drawer state, so adding contextual
// help anywhere is just <HelpButton id="some.help.id" />. The article it shows
// is looked up from src/help/articles.ts by id.
export function HelpButton({ id, label }: { id: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="help-btn"
        aria-label={label ? `What is "${label}"?` : "What is this?"}
        aria-haspopup="dialog"
        title="What is this?"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open && <HelpDrawer id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const article = getHelpArticle(id);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the drawer so Esc + screen readers work immediately.
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={article?.title ?? "Help"}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer__head">
          <h2>{article?.title ?? "Help"}</h2>
          <button className="btn btn--sm" onClick={onClose} aria-label="Close help">
            Close
          </button>
        </div>
        <div className="drawer__body">
          {article ? (
            renderMarkdown(article.body)
          ) : (
            <p className="muted">No help article is wired up for "{id}" yet.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

// --- tiny Markdown renderer ---------------------------------------------------
// Supports the small subset the articles use: ## / ### headings, "- " bullet
// lists, "> " blockquotes, blank-line-separated paragraphs, and inline **bold**
// and `code`. Deliberately minimal — no dependency, and the input is trusted
// (authored in src/help/articles.ts, not user content).

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on **bold** and `code`, keeping the delimiters' content.
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  tokens.forEach((tok, i) => {
    if (!tok) return;
    if (tok.startsWith("**") && tok.endsWith("**")) {
      out.push(<strong key={i}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`") && tok.endsWith("`")) {
      out.push(<code key={i}>{tok.slice(1, -1)}</code>);
    } else {
      out.push(<Fragment key={i}>{tok}</Fragment>);
    }
  });
  return out;
}

function renderMarkdown(md: string): ReactNode[] {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={key++}>{renderInline(para.join(" "))}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={key++}>
          {list.map((li, i) => (
            <li key={i}>{renderInline(li)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("### ")) {
      flushPara();
      flushList();
      blocks.push(<h4 key={key++}>{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith("## ")) {
      flushPara();
      flushList();
      blocks.push(<h3 key={key++}>{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith("- ")) {
      flushPara();
      list.push(line.slice(2));
    } else if (line.startsWith("> ")) {
      flushPara();
      flushList();
      blocks.push(
        <blockquote key={key++} className="drawer__note">
          {renderInline(line.slice(2))}
        </blockquote>
      );
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
