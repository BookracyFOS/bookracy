export interface SearchParams {
  query: string;
  lang: string;
  limit: number;
  page?: number;
  // Optional Anna's Archive facets (validated server-side): content type
  // (e.g. book_fiction), file extension (e.g. epub) and sort order.
  content?: string;
  ext?: string;
  sort?: string;
}
