import { type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Award, BookOpen, ChevronRight, ExternalLink, Library, Quote, Search, Sparkles } from "lucide-react";
import {
  fiveBooksBestQueryOptions,
  fiveBooksCategoryQueryOptions,
  fiveBooksInterviewQueryOptions,
  type FiveBooksBook,
  type FiveBooksInterview,
} from "@/api/backend/fivebooks/fivebooks";
import { FIVE_BOOKS_TAXONOMY, FIVE_BOOKS_YEARS, findFiveBooksLabel } from "@/lib/fivebooks-taxonomy";
import { BookCover } from "@/components/books/book-cover";
import { Skeleton } from "@/components/ui/skeleton";

// Five Books identity accent (warm literary gold), consumed as hsl(var(--fb-accent) / …).
const FB_ACCENT = "36 92% 50%";
const ROUTE = "/recommendations/five-books" as const;

export interface FiveBooksView {
  cat?: string;
  best?: string;
  interview?: string;
}

export function FiveBooksPage({ cat, best, interview }: FiveBooksView) {
  const rootStyle = { "--fb-accent": FB_ACCENT } as CSSProperties;
  return (
    <div className="flex flex-col gap-6" style={rootStyle}>
      {interview ? <InterviewView slug={interview} /> : best ? <ListView kind="best" value={best} /> : cat ? <ListView kind="category" value={cat} /> : <HomeView />}
    </div>
  );
}

/* ------------------------------------------------------------------ shared bits */

function Accent({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "hsl(var(--fb-accent))" }}>{children}</span>;
}

function BackLink({ label = "All of Five Books", to = ROUTE, search }: { label?: string; to?: string; search?: FiveBooksView }) {
  return (
    <Link to={to} search={search ?? {}} className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm font-medium transition-colors">
      <ChevronRight className="h-4 w-4 rotate-180" />
      {label}
    </Link>
  );
}

function Hero({ icon: Icon, title, subtitle, kicker }: { icon: typeof BookOpen; title: React.ReactNode; subtitle?: React.ReactNode; kicker?: string }) {
  return (
    <div className="glass relative overflow-hidden rounded-3xl p-6 sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full blur-3xl" style={{ background: "radial-gradient(closest-side, hsl(var(--fb-accent) / 0.35), transparent)" }} />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
          style={{
            background: "linear-gradient(135deg, hsl(var(--fb-accent) / 0.95), hsl(var(--fb-accent) / 0.55))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.35), 0 18px 40px -18px hsl(var(--fb-accent) / 0.85)",
          }}
        >
          <Icon className="h-7 w-7 text-white" />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          {kicker && <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "hsl(var(--fb-accent))" }}>{kicker}</span>}
          <h1 className="from-foreground to-foreground/60 bg-gradient-to-br bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">{title}</h1>
          {subtitle && <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

/** A small stack of book covers, gently fanned; spreads on hover. */
function CoverFan({ books }: { books: FiveBooksBook[] }) {
  const shown = books.slice(0, 5);
  return (
    <div className="flex items-end">
      {shown.map((b, i) => (
        <div
          key={i}
          className="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-md shadow-md transition-all duration-300 ease-out group-hover:-translate-y-0.5 sm:w-14"
          style={{ marginLeft: i === 0 ? 0 : -18, zIndex: i, transform: `rotate(${(i - (shown.length - 1) / 2) * 2}deg)` }}
        >
          <BookCover src={b.cover} alt={b.title} referrerPolicy="no-referrer" showCaption={false} />
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- home */

function HomeView() {
  return (
    <>
      <Hero
        icon={Library}
        kicker="Five Books"
        title={<>The best books on <Accent>every subject</Accent></>}
        subtitle="Expert-curated recommendations from fivebooks.com — every list chosen by a leading authority or award-winner in their field. Pick a subject, meet the expert, tap any book to find it on Bookracy."
      />

      {/* Best of the year */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5" style={{ color: "hsl(var(--fb-accent))" }} />
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Best Books of the Year</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FIVE_BOOKS_YEARS.map((year) => (
            <Link
              key={year}
              to={ROUTE}
              search={{ best: year }}
              className="glass glass-hover group relative overflow-hidden rounded-2xl p-5"
              style={{ boxShadow: "inset 0 1px 0 var(--glass-sheen)" }}
            >
              <div aria-hidden className="pointer-events-none absolute -top-10 -right-6 h-28 w-28 rounded-full blur-2xl transition-opacity group-hover:opacity-100" style={{ background: "radial-gradient(closest-side, hsl(var(--fb-accent) / 0.4), transparent)", opacity: 0.6 }} />
              <div className="relative flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-3xl font-bold tracking-tight tabular-nums">{year}</span>
                  <span className="text-muted-foreground text-sm">The year’s best, across every subject</span>
                </div>
                <Sparkles className="h-6 w-6 transition-transform group-hover:scale-110" style={{ color: "hsl(var(--fb-accent))" }} />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Taxonomy directory (the full nonfiction menu) */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" style={{ color: "hsl(var(--fb-accent))" }} />
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Browse by Subject</h2>
        </div>
        <div className="gap-4 [column-fill:_balance] sm:columns-2 lg:columns-3 xl:columns-4">
          {FIVE_BOOKS_TAXONOMY.map((group) => (
            <div key={group.path} className="glass mb-4 inline-block w-full break-inside-avoid rounded-2xl p-4">
              <Link
                to={ROUTE}
                search={{ cat: group.path }}
                className="group flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-sm font-bold tracking-tight transition-colors hover:[color:hsl(var(--fb-accent))]"
              >
                <span>{group.label}</span>
                <ChevronRight className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "hsl(var(--fb-accent))" }} />
              </Link>
              {group.items.length > 0 && (
                <ul className="mt-1 flex flex-col">
                  {group.items.map((item) => (
                    <li key={item.path}>
                      <Link
                        to={ROUTE}
                        search={{ cat: item.path }}
                        className="text-muted-foreground hover:text-foreground block rounded-md px-1 py-1 text-sm transition-colors hover:bg-[hsl(var(--fb-accent)/0.08)]"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Recommendations sourced from{" "}
          <a href="https://fivebooks.com" target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-4 hover:underline" style={{ color: "hsl(var(--fb-accent))" }}>
            fivebooks.com
          </a>
          .
        </p>
      </section>
    </>
  );
}

/* -------------------------------------------------------------- list (category / best) */

function ListView({ kind, value }: { kind: "category" | "best"; value: string }) {
  const query = useQuery(kind === "best" ? fiveBooksBestQueryOptions(value) : fiveBooksCategoryQueryOptions(value));
  const interviews = query.data?.interviews ?? [];
  const title = kind === "best" ? `The Best Books of ${value}` : findFiveBooksLabel(value) ?? "Five Books";
  const subtitle =
    kind === "best"
      ? "The standout books of the year, each list chosen by an expert or prize jury."
      : "Expert reading lists on this subject — each recommended by a leading authority in the field.";

  return (
    <>
      <BackLink />
      <Hero icon={kind === "best" ? Award : Library} kicker="Five Books" title={<>{title}</>} subtitle={subtitle} />

      {query.isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="skeleton-shimmer h-[168px] w-full rounded-2xl" />
          ))}
        </div>
      )}

      {query.error && <p className="text-destructive text-sm">Couldn’t load these recommendations. Please try again later.</p>}

      {!query.isLoading && !query.error && interviews.length === 0 && (
        <p className="text-muted-foreground py-8 text-center">No recommendations found here yet.</p>
      )}

      {interviews.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {interviews.map((it) => (
            <InterviewCard key={it.slug} interview={it} />
          ))}
        </div>
      )}
    </>
  );
}

function InterviewCard({ interview }: { interview: FiveBooksInterview }) {
  return (
    <Link to={ROUTE} search={{ interview: interview.slug }} className="glass glass-hover group flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="line-clamp-2 text-base font-bold tracking-tight sm:text-lg group-hover:[color:hsl(var(--fb-accent))]">{interview.subject}</h3>
          {interview.expert && (
            <p className="text-muted-foreground text-sm">
              recommended by <span className="text-foreground font-medium">{interview.expert}</span>
            </p>
          )}
        </div>
        <span className="glass-subtle text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums">
          {interview.books.length}
          <BookOpen className="h-3 w-3" />
        </span>
      </div>
      <CoverFan books={interview.books} />
    </Link>
  );
}

/* ------------------------------------------------------------------- interview */

function InterviewView({ slug }: { slug: string }) {
  const query = useQuery(fiveBooksInterviewQueryOptions(slug));
  const iv = query.data?.interview;
  const source = `https://fivebooks.com/best-books/${slug}/`;

  return (
    <>
      <BackLink />

      {query.isLoading && <Skeleton className="skeleton-shimmer h-[180px] w-full rounded-3xl" />}
      {query.error && <p className="text-destructive text-sm">Couldn’t load this interview. Please try again later.</p>}

      {iv && (
        <>
          <div className="glass relative overflow-hidden rounded-3xl p-6 sm:p-8">
            <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full blur-3xl" style={{ background: "radial-gradient(closest-side, hsl(var(--fb-accent) / 0.35), transparent)" }} />
            <div className="relative flex flex-col gap-3">
              <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "hsl(var(--fb-accent))" }}>Five Books · Expert Recommendations</span>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{iv.subject}</h1>
              {iv.expert && (
                <p className="text-muted-foreground flex items-center gap-2 text-sm sm:text-base">
                  <Quote className="h-4 w-4" style={{ color: "hsl(var(--fb-accent))" }} />
                  recommended by <span className="text-foreground font-semibold">{iv.expert}</span>
                </p>
              )}
              <a href={source} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline" style={{ color: "hsl(var(--fb-accent))" }}>
                Read the full interview on Five Books
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {iv.books.map((book, i) => (
              <BookRow key={i} n={i + 1} book={book} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function BookRow({ n, book }: { n: number; book: FiveBooksBook }) {
  const q = [book.title, book.author].filter(Boolean).join(" ");
  return (
    <Link to="/" search={{ q }} className="glass glass-hover group flex gap-4 rounded-2xl p-4">
      <div className="relative w-20 shrink-0 sm:w-24">
        <div className="aspect-[2/3] w-full overflow-hidden rounded-lg shadow-md">
          <BookCover src={book.cover} alt={book.title} referrerPolicy="no-referrer" showCaption={false} />
        </div>
        <span
          className="absolute -top-2 -left-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white shadow"
          style={{ background: "linear-gradient(135deg, hsl(var(--fb-accent) / 0.95), hsl(var(--fb-accent) / 0.6))" }}
        >
          {n}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <h3 className="line-clamp-3 font-semibold tracking-tight group-hover:[color:hsl(var(--fb-accent))]">{book.title}</h3>
        {book.author && <p className="text-muted-foreground line-clamp-1 text-sm">{book.author}</p>}
        <span className="text-muted-foreground/80 mt-1 inline-flex items-center gap-1 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">
          <Search className="h-3 w-3" style={{ color: "hsl(var(--fb-accent))" }} />
          Find on Bookracy
        </span>
      </div>
    </Link>
  );
}
