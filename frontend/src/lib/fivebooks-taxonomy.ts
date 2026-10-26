// The Five Books (fivebooks.com) nonfiction taxonomy, mirrored faithfully from their
// mega-menu so we can render a browsable directory. Each `path` is the fivebooks.com
// category slug the backend scrapes via /api/fivebooks?type=category&path=<path>.
// Groups with an empty `items` array are standalone categories (their header links out).

export interface FiveBooksCategory {
  label: string;
  path: string;
}

export interface FiveBooksGroup {
  label: string;
  /** The group heading is itself a category page (present for every group). */
  path: string;
  items: FiveBooksCategory[];
}

/** The three "best books of the year" cross-subject collections (their own priority row). */
export const FIVE_BOOKS_YEARS = ["2025", "2024", "2023"] as const;

export const FIVE_BOOKS_TAXONOMY: FiveBooksGroup[] = [
  {
    label: "Nonfiction",
    path: "nonfiction-books",
    items: [
      { label: "Best Nonfiction 2025", path: "nonfiction-books/the-best-nonfiction-books-of-2025" },
      { label: "Best Nonfiction 2024", path: "nonfiction-books/best-nonfiction-books-of-2024" },
    ],
  },
  {
    label: "Biographies",
    path: "biography",
    items: [
      { label: "Historical Biographies", path: "biography/historical-biographies" },
      { label: "Memoirs & Autobiographies", path: "biography/memoir" },
      { label: "Philosophical Biographies", path: "philosophy/philosophical-biographies" },
    ],
  },
  { label: "True Crime", path: "nonfiction-books/true-crime", items: [] },
  {
    label: "History",
    path: "history-books",
    items: [
      { label: "World War 2", path: "history-books/world-war-2" },
      { label: "World History", path: "history-books/world-history-books" },
      { label: "American History", path: "history/american-history" },
      { label: "British History", path: "history-books/british-history" },
      { label: "Chinese History", path: "history-books/chinese-history" },
      { label: "Russian History", path: "history-books/russian-history" },
      { label: "Ancient History", path: "history-books/ancient-history" },
      { label: "Medieval History", path: "history-books/medieval-history" },
      { label: "Military History", path: "history-books/military-history" },
    ],
  },
  { label: "Art", path: "art-books", items: [{ label: "Art History", path: "art-books/history-of-art" }] },
  { label: "Travel", path: "nonfiction-books/travel-books", items: [] },
  { label: "Essays", path: "nonfiction-books/essays", items: [] },
  {
    label: "Philosophy",
    path: "philosophy",
    items: [
      { label: "Ancient Philosophy", path: "philosophy/ancient-philosophy" },
      { label: "Contemporary Philosophy", path: "philosophy/contemporary-philosophy" },
      { label: "Ethics & Moral Philosophy", path: "philosophy/ethics-moral-philosophy" },
      { label: "Great Philosophers", path: "philosophy/great-philosophers" },
      { label: "Social & Political Philosophy", path: "philosophy/social-political-philosophy" },
    ],
  },
  {
    label: "Science",
    path: "mathematics-and-science",
    items: [
      { label: "Astronomy", path: "mathematics-and-science/astronomy" },
      { label: "Biology", path: "mathematics-and-science/biology" },
      { label: "Chemistry", path: "mathematics-and-science/chemistry" },
      { label: "Maths & Statistics", path: "mathematics-and-science/maths-statistics" },
      { label: "Popular Science", path: "mathematics-and-science/popular-science" },
      { label: "Physics", path: "mathematics-and-science/physics" },
    ],
  },
  { label: "Nature", path: "nature", items: [] },
  { label: "Environment", path: "environment", items: [{ label: "Climate Change", path: "environment/climate-change" }] },
  {
    label: "Language",
    path: "language",
    items: [
      { label: "How to Write", path: "language/writing-books" },
      { label: "English Grammar & Usage", path: "language/grammar-books" },
      { label: "Learning Languages", path: "language/learning-languages" },
      { label: "Linguistics", path: "language/linguistics" },
    ],
  },
  {
    label: "Politics & Society",
    path: "politics-and-society",
    items: [
      { label: "Political Ideologies", path: "politics-and-society/political-ideologies" },
      { label: "Migration", path: "politics-and-society/migration" },
      { label: "War", path: "politics-and-society/war" },
      { label: "Foreign Policy & International Relations", path: "politics-and-society/foreign-policy-international-relations" },
      { label: "American Politics", path: "politics-and-society/american-politics" },
      { label: "British Politics", path: "politics-and-society/british-politics" },
    ],
  },
  {
    label: "Religion",
    path: "religion",
    items: [
      { label: "Theology", path: "religion/theology" },
      { label: "Buddhism", path: "religion/buddhism" },
      { label: "Christian", path: "religion/christian-books" },
      { label: "Islamic", path: "religion/islamic" },
      { label: "Jewish", path: "religion/jewish-books" },
      { label: "Religious History", path: "history-books/religious-history" },
    ],
  },
  { label: "Law", path: "law-and-constitutions", items: [] },
  {
    label: "Psychology",
    path: "psychology",
    items: [
      { label: "Mental Health", path: "psychology/mental-health" },
      { label: "Neuroscience", path: "psychology/neuroscience" },
      { label: "Self Help", path: "psychology/self-help" },
      { label: "Child Psychology", path: "psychology/child-psychology" },
    ],
  },
  {
    label: "Economics",
    path: "economics",
    items: [
      { label: "Behavioural Economics", path: "economics/behavioural-economics" },
      { label: "Development Economics", path: "economics/development-economics" },
      { label: "Economic History", path: "economics/economic-history" },
      { label: "Finance", path: "economics/finance" },
      { label: "Financial Crisis", path: "economics/financial-crisis" },
      { label: "World Economies", path: "economics/world-economies" },
    ],
  },
  { label: "Business", path: "business", items: [{ label: "Investing", path: "business/best-investing-books" }] },
  {
    label: "Technology",
    path: "technology",
    items: [
      { label: "Artificial Intelligence", path: "technology/artificial-intelligence" },
      { label: "Data Science", path: "technology/data-science-books" },
      { label: "Computing", path: "technology/computing" },
    ],
  },
  {
    label: "Health & Lifestyle",
    path: "health-and-lifestyle",
    items: [
      { label: "Happiness", path: "health-and-lifestyle/happiness" },
      { label: "Sex & Sexuality", path: "health-and-lifestyle/sex-sexuality" },
      { label: "Death & Dying", path: "health-and-lifestyle/death" },
      { label: "Education", path: "health-and-lifestyle/education" },
    ],
  },
  { label: "Food & Cooking", path: "food-and-cooking", items: [] },
  { label: "Sports, Games & Hobbies", path: "sports-games-and-hobbies", items: [] },
];

/** Look up a category's human label by its path (for headings/breadcrumbs). */
export function findFiveBooksLabel(path: string): string | undefined {
  for (const group of FIVE_BOOKS_TAXONOMY) {
    if (group.path === path) return group.label;
    const item = group.items.find((i) => i.path === path);
    if (item) return item.label;
  }
  return undefined;
}
