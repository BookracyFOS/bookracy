import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui/select";

interface PerPageSelectProps {
  perPage: number;
  setPerPage: (perPage: number) => void;
}

const PER_PAGE_OPTIONS = [5, 10, 15, 30, 50] as const;

function PerPageSelect({ perPage, setPerPage }: PerPageSelectProps) {
  return (
    <Select defaultValue={perPage.toString()} value={perPage.toString()} onValueChange={(value) => setPerPage(Number(value))}>
      <SelectTrigger className="h-11 w-[80px]">
        <SelectValue placeholder="Select per page" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Per page</SelectLabel>
          {PER_PAGE_OPTIONS.map((option) => (
            <SelectItem key={option} value={option.toString()}>
              {option}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export interface FilterProps {
  perPage: number;
  setPerPage: (perPage: number) => void;
}

// The list/grid switch now lives globally in the navbar (see ViewToggle), so this
// row only carries the per-page control.
export function Filters({ perPage, setPerPage }: FilterProps) {
  return (
    <div className="flex justify-end gap-4">
      <PerPageSelect perPage={perPage} setPerPage={setPerPage} />
    </div>
  );
}

// Sentinel values for "no filter" — Radix Select items can't use an empty string.
const ANY_FORMAT = "all";
const ANY_TYPE = "all";
const ANY_LANG = "all";
const RELEVANCE = "relevance";

// Each value maps 1:1 to an Anna's Archive facet validated by the backend.
const FORMAT_OPTIONS = [
  { value: ANY_FORMAT, label: "Any format" },
  { value: "epub", label: "EPUB" },
  { value: "pdf", label: "PDF" },
  { value: "mobi", label: "MOBI" },
  { value: "azw3", label: "AZW3" },
  { value: "cbz", label: "CBZ" },
  { value: "cbr", label: "CBR" },
  { value: "djvu", label: "DjVu" },
  { value: "fb2", label: "FB2" },
  { value: "txt", label: "TXT" },
] as const;

const TYPE_OPTIONS = [
  { value: ANY_TYPE, label: "Any type" },
  { value: "book_fiction", label: "Fiction" },
  { value: "book_nonfiction", label: "Non-fiction" },
  { value: "book_comic", label: "Comic" },
  { value: "magazine", label: "Magazine" },
  { value: "journal_article", label: "Papers" },
  { value: "book_unknown", label: "Other" },
] as const;

const SORT_OPTIONS = [
  { value: RELEVANCE, label: "Most relevant" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "largest", label: "Largest" },
  { value: "smallest", label: "Smallest" },
] as const;

const LANGUAGE_OPTIONS = [
  { value: ANY_LANG, label: "All languages" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ru", label: "Russian" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
] as const;

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11 min-w-[120px]" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{label}</SelectLabel>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export interface SearchFiltersProps {
  language: string;
  setLanguage: (value: string) => void;
  contentType: string;
  setContentType: (value: string) => void;
  fileType: string;
  setFileType: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
}

// Surfaces the Anna's Archive search facets the backend already supports
// (content type, file extension, language, sort) as a row of dropdowns.
export function SearchFilters({ language, setLanguage, contentType, setContentType, fileType, setFileType, sort, setSort }: SearchFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2 sm:gap-3">
      <FilterSelect label="Type" value={contentType} onChange={setContentType} options={TYPE_OPTIONS} />
      <FilterSelect label="Format" value={fileType} onChange={setFileType} options={FORMAT_OPTIONS} />
      <FilterSelect label="Language" value={language} onChange={setLanguage} options={LANGUAGE_OPTIONS} />
      <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
    </div>
  );
}

// Map UI sentinels back to the backend's expected values (or undefined = omit).
export const filterToParam = (value: string) => (value === ANY_FORMAT || value === ANY_TYPE || value === ANY_LANG || value === RELEVANCE ? undefined : value);
export const FILTER_DEFAULTS = { contentType: ANY_TYPE, fileType: ANY_FORMAT, sort: RELEVANCE } as const;
